const express = require("express");
const httpProxy = require("http-proxy");
const { PrismaClient } = require("@prisma/client");

const app = express();
const PORT = 8000;

const prisma = new PrismaClient({});

const BASE_PATH = "";

const proxy = httpProxy.createProxy();

app.use(async (req, res) => {
  const hostname = req.hostname;
  const subDomain = hostname.split(".")[0];

  const project = await prisma.project.findUnique({
    where: {
      subDomain: subDomain,
    },
  });

  const resolvesTo = `${BASE_PATH}/${project.id}`;

  return proxy.web(req, res, { target: resolvesTo, changeOrigin: true });
});

proxy.on("proxyReq", (proxyReq, req, res) => {
  const url = req.url;

  if (url === "/") {
    proxyReq.path += "index.html";
  }
});

app.listen(PORT, () => console.log(`Reverse Proxy Running..${PORT}`));
