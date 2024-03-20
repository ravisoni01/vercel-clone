const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const mime = require("mime-types");
const { Kafka } = require("kafkajs");

const s3Client = new S3Client({
  region: "ap-south-1",
  credentials: {
    accessKeyId: "",
    secretAccessKey: "",
  },
});

const PROJECT_ID = process.env.PROJECT_ID;
const DEPLOYMENT_ID = process.env.DEPLOYMENT_ID;

const kafka = new Kafka({
  clientId: `docker-build-server-${DEPLOYMENT_ID}`,
  brokers: [""],
  sasl: {
    username: "",
    password: "",
    mechanism: "plain",
  },
  ssl: {
    ca: [fs.readFileSync(path.join(__dirname, "kafka-ca.pem"), "utf-8")],
  },
});

const producer = kafka.producer();

async function publishLog(log) {
  await producer.send({
    topic: `container-logs`,
    messages: [
      { key: "log", value: JSON.stringify({ PROJECT_ID, DEPLOYMENT_ID, log }) },
    ],
  });
}

async function init() {
  await producer.connect();
  console.log("Executing script.js");
  await publishLog("Build Started...");
  const outDirPath = path.join(__dirname, "output");

  const p = exec(`cd ${outDirPath} && npm install && npm run build`);

  p.stdout.on("data", async function (data) {
    console.log(data.toString());
    await publishLog(data.toString());
  });

  p.stdout.on("error", async function (error) {
    console.log("ERROR: ", error.toString());
    await publishLog(`ERROR: ${data.toString()}`);
  });

  p.stdout.on("close", async function () {
    console.log("Build Completed");
    await publishLog("Build Completed");

    const distFolderPath = path.join(__dirname, "output", "dist");
    const distFolderContents = fs.readdirSync(distFolderPath, {
      recursive: true,
    });

    await publishLog("Starting To Uploading...");
    for (const file of distFolderContents) {
      const filePath = path.join(distFolderPath, file);
      if (fs.lstatSync(filePath).isDirectory()) continue;

      console.log("Uploading...", filePath);
      await publishLog(`Uploading ${file}`);

      const command = new PutObjectCommand({
        Bucket: "practice-vercel-clone-project",
        Key: `__outputs/${PROJECT_ID}/${file}`,
        Body: fs.createReadStream(filePath),
        ContentType: mime.lookup(filePath),
      });

      await s3Client.send(command);

      await publishLog(`Uploaded ${file}`);
      console.log("Uploaded", filePath);
    }

    await publishLog("Process Done...");
    console.log("Process Done...");
    process.exit(0);
  });
}

init();
