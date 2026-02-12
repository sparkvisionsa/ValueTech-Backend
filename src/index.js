require("dotenv").config();
const http = require("http");
const { Server } = require("socket.io");
const app = require("./app");
const { connect } = require("./infrastructure/connect");
const registerTicketSocket = require("./presentation/sockets/ticket.socket");
const { setSocketServer } = require("./presentation/sockets/socketRegistry");

const PORT = process.env.PORT || 3000;

async function main() {
  await connect();

  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: true,
      credentials: true,
    },
  });

  setSocketServer(io);
  registerTicketSocket(io);

  server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

main().catch((err) => {
  console.error("Failed to start", err);
  process.exit(1);
});
