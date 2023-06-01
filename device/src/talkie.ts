import fs from "fs-extra";
import { PvRecorder } from "@picovoice/pvrecorder-node";
import { server as WebSocketServer } from "websocket";
import wavConverter from "wav-converter";
import http from "http";
import { join } from "path";
import { play, playMp3 } from "./audio";
import { Gpio } from "onoff";
import * as dotenv from "dotenv";
import { ChatCompletionRequestMessage, Configuration, OpenAIApi } from "openai";
import { Readable } from "node:stream";
import { preamble } from "./chat-preamble";

dotenv.config();

const makeMessage = (role, content) => ({ role, content });

let history: ChatCompletionRequestMessage[] = [
  // { role: "system", content: "you are an AI assistant. answer tersely" },
  ...preamble(
    {
      shortName: process.env.USER_SHORTNAME || "TU",
      fullName: process.env.USER_NAME || "Test User",
    },
    {}
  ),
];

const openai = new OpenAIApi(
  new Configuration({ apiKey: process.env.OPENAI_KEY })
);

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

type TalkieCommand = "Record" | "Abort" | "Save" | "Query";

const testButton = new Gpio(14, "in", "both", {
  debounceTimeout: 20,
});

const bztVoiceId = "8rhGl4iiilgahpSoYwwp";

const media = {
  discard: "FX-Discard.wav",
  query: "FX-Query.wav",
  record: "FX-Record.wav",
  save: "FX-Save.wav",
  startup: "FX-Startup.wav",
} as const;

function playSoundEffect(key: keyof typeof media) {
  const fileName = media[key];
  const soundPath = join(__dirname, "..", "media", fileName);
  play(soundPath);
}

type TalkieState = {
  isRecording: boolean;
};

let talkieState: TalkieState = {
  isRecording: false,
};

testButton.watch((err, isUp) => {
  console.log("Button Interrupt! " + (isUp ? "(up)" : "(down)"));
  if (isUp) {
    if (talkieState.isRecording) {
      talkieQuery();
    } else {
      talkieRecord();
    }
  }
});

function updateTalkieState(updater: (v: TalkieState) => TalkieState) {
  const newState = updater(talkieState);
  talkieState = newState;
}

const recorder = new PvRecorder(-1, 512);

let audioWriteStream: fs.WriteStream | null = null;

let recordTick = Promise.resolve();

let completeRecord:
  | (() => Promise<{ id: string; wavPath: string } | null>)
  | null = null;

async function talkieRecord() {
  playSoundEffect("record");

  const recordStartTime = Date.now();
  const recordId = new Date().toISOString();
  if (talkieState.isRecording) return;
  audioWriteStream = fs.createWriteStream(
    `/home/pi/recordings/recording-${recordId}.pcm`,
    { flags: "w" }
  );
  recorder.start();
  let recordedAudioBuffer = Buffer.from([]);

  function handleTick() {
    if (!talkieState.isRecording) return;
    recordTick = recordTick.then(async () => {
      if (!talkieState.isRecording) return;
      const pcm = await recorder.read();
      recordedAudioBuffer = Buffer.concat([
        recordedAudioBuffer,
        Buffer.from(pcm.buffer),
      ]);
      audioWriteStream?.write(Buffer.from(pcm.buffer));
      handleTick();
    });
  }

  completeRecord = async () => {
    await recordTick;
    recorder.stop();
    if (audioWriteStream) {
      audioWriteStream.close();
    }
    if (recordedAudioBuffer) {
      const wavData = wavConverter.encodeWav(recordedAudioBuffer, {});
      const wavPath = `/home/pi/recordings/recording-${recordId}.wav`;
      await fs.writeFile(wavPath, wavData);
      return {
        id: recordId,
        wavPath,
      };
    }
    return null;
  };

  updateTalkieState((s) => ({ ...s, isRecording: true }));
  handleTick();
}

async function closeRecording() {
  updateTalkieState((v) => ({ ...v, isRecording: false }));

  if (completeRecord) return await completeRecord();

  return null;
}

async function sayText(text: string) {
  const sayingId = new Date().toISOString();
  const sayingPath = `/home/pi/say/${sayingId}.mp3`;
  const url = `https://api.elevenlabs.io/v1/text-to-speech/8rhGl4iiilgahpSoYwwp`;
  const res = await fetch(url, {
    headers: {
      "content-type": "application/json",
      "xi-api-key": process.env.ELEVENLABS_KEY || "",
    },
    method: "post",
    body: JSON.stringify({
      text,
      model_id: process.env.ELEVENLABS_MODEL || "eleven_monolingual_v1",
      voice_settings: {
        stability: 0.7,
        similarity_boost: 0,
      },
    }),
  });
  if (res.status !== 200) {
    console.error(await res.text());
    throw new Error("Failed to say");
  }
  const blob = await res.blob();
  const arrayBuffer = await blob.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  await fs.writeFile(sayingPath, buffer);

  playMp3(sayingPath);
}

async function talkieAbort() {
  await closeRecording();
  playSoundEffect("discard");

  sayText("ooh push my buttons, big brother");
}

async function talkieQuery() {
  const recording = await closeRecording();

  playSoundEffect("query");

  if (!recording) return;
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const audioReadStream = Readable.from(await fs.readFile(recording.wavPath));
  // @ts-ignore
  audioReadStream.path = "conversation.wav";
  const {
    data: { text },
  } = await openai.createTranscription(
    // @ts-ignore
    audioReadStream,
    "whisper-1"
  );

  history = [...history, { role: "user", content: text }];

  console.log("FUll query", history);
  const { data } = await openai.createChatCompletion({
    messages: history,
    model: process.env.OPENAI_MODEL || "gpt-3.5-turbo",
    temperature: 0.7,
  });
  const message = data.choices[0].message;

  console.log(":::" + message?.content);

  if (!message) {
    throw new Error("Message could not be extracted from result");
  }
  history = [...history, message];

  const matchedSay = message?.content.match(/\$say:(?<statement>.*)$/m);
  const statementOutLout = matchedSay?.groups?.statement;
  const matchedSayNothing = message?.content.match(/\$saynothing/m);

  if (statementOutLout || matchedSayNothing) {
    if (statementOutLout) sayText(statementOutLout);
  } else {
    // ERROR CORRECTION BEHAVIOR

    history = [
      ...history,
      {
        role: "system",
        content:
          "please continue by writing $say: with a statement to speak out loud, or if appropriate, stay silent with $saynothing",
      },
    ];

    console.log("FUll query", history);
    const { data } = await openai.createChatCompletion({
      messages: history,
      model: process.env.OPENAI_MODEL || "gpt-3.5-turbo",
      temperature: 0.7,
    });
    const message = data.choices[0].message;

    console.log(":::" + message?.content);

    if (!message) {
      throw new Error("Message could not be extracted from result");
    }
    history = [...history, message];

    // fallback. the ai screwed up
    console.log("todooooo", message);
  }
}

async function talkieSave() {
  await closeRecording();
  playSoundEffect("save");
}

function asyncify<V>(promise: Promise<V>) {
  promise.catch((e) => {
    console.error("Failed.", e);
  });
}

function handleTalkieCommand(command: TalkieCommand) {
  console.log("Command: " + JSON.stringify(command));
  switch (command) {
    case "Abort":
      return asyncify(talkieAbort());
    case "Record":
      return asyncify(talkieRecord());
    case "Query":
      return asyncify(talkieQuery());
    case "Save":
      return asyncify(talkieSave());
  }
}

async function startupTalkie() {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  // playSoundEffect("startup");
}

startupTalkie();

wsServer.on("request", function (request) {
  // check request.origin and call request.reject() if not allowed

  var connection = request.accept(null, request.origin);
  console.log(new Date() + " Connection accepted.");

  function connectionSend(data: any) {
    connection.sendUTF(JSON.stringify(data));
  }
  connectionSend({ type: "Welcome" });
  connection.on("message", function (message) {
    if (message.type === "utf8") {
      try {
        const payload: TalkieCommand = JSON.parse(message.utf8Data);
        handleTalkieCommand(payload);
      } catch (e) {
        console.error("Failed.", e);
      }
    } else {
      console.error(
        "Received Unknown WS Message (it should be a utf8-JSON TalkieCommand)"
      );
    }
  });
  connection.on("close", function (reasonCode: number, description: string) {
    console.log(
      new Date() + " Peer " + connection.remoteAddress + " disconnected."
    );
  });
});
