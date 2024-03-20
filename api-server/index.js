const express = require("express");
const { generateSlug } = require("random-word-slugs");
const { ECSClient, RunTaskCommand } = require("@aws-sdk/client-ecs");
// const { Server } = require("socket.io");
const { z } = require("zod");
const { PrismaClient } = require("@prisma/client");
const { createClient } = require("@clickhouse/client");
const { Kafka } = require("kafkajs");
const { v4: uuidv4 } = require("uuid");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 9000;

const client = createClient({
  host: "",
  database: "default",
  username: "",
  password: "",
});

const kafka = new Kafka({
  clientId: `api-server`,
  brokers: [""],
  sasl: {
    username: "avnadmin",
    password: "",
    mechanism: "plain",
  },
  ssl: {
    ca: [fs.readFileSync(path.join(__dirname, "kafka-ca.pem"), "utf-8")],
  },
});

const prisma = new PrismaClient({});

// const io = new Server({ cors: "*" });

const consumer = kafka.consumer({ groupId: "api-server-logs-consumer" });

// io.on("connection", (socket) => {
//   socket.on("subscribe", (channel) => {
//     socket.join(channel);
//     socket.emit("message", `Joined ${channel}`);
//   });
// });

// io.listen(9001, () => console.log("Socket Server running on 9001"));

const ecsClient = new ECSClient({
  region: "ap-south-1",
  credentials: {
    accessKeyId: "",
    secretAccessKey: "",
  },
});

const config = {
  CLUSTER: "",
  TASK: "",
};

app.use(express.json());
app.use(cors());

app.post("/project", async (req, res) => {
  const schema = z.object({
    name: z.string(),
    gitURL: z.string(),
  });
  const safeParseResult = schema.safeParse(req.body);

  if (safeParseResult.error)
    return res.status(400).json({ error: safeParseResult.error });

  const { name, gitURL } = safeParseResult.data;

  const project = await prisma.project.create({
    data: {
      name,
      gitURL,
      subDomain: generateSlug(),
    },
  });

  return res.json({ status: "success", data: { project } });
});

app.post("/deploy", async (req, res) => {
  const { projectId } = req.body;

  const project = await prisma.project.findUnique({ where: { id: projectId } });

  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }

  const deployment = await prisma.deployment.create({
    data: {
      project: { connect: { id: projectId } },
      status: "QUEUED",
    },
  });

  const command = new RunTaskCommand({
    cluster: config.CLUSTER,
    taskDefinition: config.TASK,
    launchType: "FARGATE",
    count: 1,
    networkConfiguration: {
      awsvpcConfiguration: {
        assignPublicIp: "ENABLED",
        subnets: [
          "subnet-0314e2f770eaacd99",
          "subnet-0d9438e5eec3b67c7",
          "subnet-01a762584b00db2c7",
        ],
        securityGroups: ["sg-0aa9661f13f6a7be3"],
      },
    },
    overrides: {
      containerOverrides: [
        {
          name: "builder-image",
          environment: [
            {
              name: "GIT_REPOSITORY__URL",
              value: project.gitURL,
            },
            {
              name: "PROJECT_ID",
              value: projectId,
            },
            {
              name: "DEPLOYMENT_ID",
              value: deployment.id,
            },
          ],
        },
      ],
    },
  });

  await ecsClient.send(command);

  const deployedUrl = `http://${project.subDomain}.localhost:8000/`;

  return res.json({
    status: "queued",
    data: { deploymentId: deployment.id, deployedUrl },
  });
});

app.get("/logs/:id", async (req, res) => {
  const id = req.params.id;
  const logs = await client.query({
    query:
      "SELECT event_id , deployment_id, log, timestamp from log_events where deployment_id = {deployment_id:String} ORDER BY timestamp",
    query_params: {
      deployment_id: id,
    },
    format: "JSONEachRow",
  });
  const rowLogs = await logs.json();
  return res.json({ logs: rowLogs });
});

app.post("/login", async (req, res) => {
  const schema = z.object({
    name: z.string(),
    email: z.string(),
    userId: z.string(),
  });
  const safeParseResult = schema.safeParse(req.body);

  if (safeParseResult.error)
    return res.status(400).json({ error: safeParseResult.error });

  const { name, email, userId } = safeParseResult.data;

  const profile = await prisma.user.findUnique({
    where: {
      userId,
    },
  });

  if (profile) {
    return res.json({ status: "success", data: { profile } });
  }

  const newProfile = await prisma.user.create({
    data: {
      userId,
      name,
      email,
    },
  });

  return res.json({ status: "success", data: { profile: newProfile } });
});

async function initKafkaConsumer() {
  await consumer.connect();
  await consumer.subscribe({ topics: ["container-logs"] });
  await consumer.run({
    autoCommit: false,
    eachBatch: async function ({
      batch,
      heartbeat,
      resolveOffset,
      commitOffsetsIfNecessary,
    }) {
      const messages = batch.messages;
      console.log(`Received ${messages.length} messages...`);
      for (const message of messages) {
        const stringMessage = message.value.toString();
        const { PROJECT_ID, DEPLOYMENT_ID, log } = JSON.parse(stringMessage);

        try {
          await client.insert({
            table: "log_events",
            values: [{ event_id: uuidv4(), deployment_id: DEPLOYMENT_ID, log }],
            format: "JSONEachRow",
          });

          resolveOffset(message.offset);
          await commitOffsetsIfNecessary(message.offset);
          await heartbeat();
        } catch (error) {
          console.log(err);
        }
      }
    },
  });
}

initKafkaConsumer();
app.listen(PORT, () => console.log(`App Server Running..${PORT}`));
