import fs from "fs";
import { PvRecorder } from "@picovoice/pvrecorder-node";

console.log("hello world!?");

// let isInterrupted = false;

// const inputArguments = {
//   audioDeviceIndex: -1,
//   rawOutputPath: null,
// };

// async function runDemo() {
//   let rawOutputPath = "/home/pi/test/test.wav";

//   const devices = PvRecorder.getAudioDevices();
//   for (let i = 0; i < devices.length; i++) {
//     console.log(`index: ${i}, device name: ${devices[i]}`);
//   }

//   const frameLength = 512;
//   const recorder = new PvRecorder(inputArguments.audioDeviceIndex, frameLength);
//   console.log(`Using PvRecorder version: ${recorder.version}`);

//   recorder.start();
//   console.log(`Using device: ${recorder.getSelectedDevice()}`);

//   let stream;
//   if (rawOutputPath !== null) {
//     stream = fs.createWriteStream(rawOutputPath, { flags: "w" });
//   }

//   while (!isInterrupted) {
//     const pcm = await recorder.read();
//     if (rawOutputPath !== null) {
//       stream.write(Buffer.from(pcm.buffer));
//     }
//   }

//   if (rawOutputPath !== null) {
//     stream.close();
//   }

//   console.log("Stopping...");
//   recorder.release();
// }

// // setup interrupt
// process.on("SIGINT", function () {
//   isInterrupted = true;
// });

// (async function () {
//   try {
//     await runDemo();
//   } catch (e) {
//     console.error(e.toString());
//   }
// })();

import { server as WebSocketServer } from "websocket";
import http from "http";

var server = http.createServer(function (request, response) {
  console.log(new Date() + " Received request for " + request.url);
  response.writeHead(404);
  response.end();
});
server.listen(3000, function () {
  console.log(new Date() + " Server is listening on port 3000");
});

const wsServer = new WebSocketServer({
  httpServer: server,
  autoAcceptConnections: false,
});

wsServer.on("request", function (request) {
  // check request.origin and call request.reject() if not allowed

  var connection = request.accept("echo-protocol", request.origin);
  console.log(new Date() + " Connection accepted.");
  connection.on("message", function (message) {
    if (message.type === "utf8") {
      console.log("Received Message: " + message.utf8Data);
      connection.sendUTF(message.utf8Data);
    } else if (message.type === "binary") {
      console.log(
        "Received Binary Message of " + message.binaryData.length + " bytes"
      );
      connection.sendBytes(message.binaryData);
    }
  });
  connection.sendUTF(JSON.stringify({ type: "Welcome" }));
  connection.on("close", function (reasonCode: number, description: string) {
    console.log(
      new Date() + " Peer " + connection.remoteAddress + " disconnected."
    );
  });
});
