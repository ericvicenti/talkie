import React, { useEffect } from "react";
import { Button, MantineProvider } from "@mantine/core";
import toast, { Toaster } from "react-hot-toast";

import ReconnectingWebSocket from "reconnecting-websocket";

const rws = new ReconnectingWebSocket("ws://talkie:3000", [], {});

rws.addEventListener("open", (conn) => {
  toast.success("Connected to Talkie!");
});

type TalkieCommand = "Record" | "Abort" | "Save" | "Query";

function sendCommand(cmd: TalkieCommand) {
  rws.send(JSON.stringify({ cmd }));
}

rws.addEventListener("message", (event) => {
  toast("Got data from pi!", event.data);
});

rws.addEventListener("close", (event) => {
  toast.error("Connection closed!");
});

rws.addEventListener("error", (event) => {
  toast.error("Connection error!");
});

function Dashboard() {
  return (
    <>
      <Button
        onClick={() => {
          sendCommand("Record");
        }}
      >
        Record
      </Button>
      <Button
        onClick={() => {
          sendCommand("Abort");
        }}
      >
        Abort
      </Button>
      <Button
        onClick={() => {
          sendCommand("Query");
        }}
      >
        Query
      </Button>
      <Button
        onClick={() => {
          sendCommand("Save");
        }}
      >
        Save
      </Button>
    </>
  );
}

export function App() {
  return (
    <>
      <MantineProvider withGlobalStyles withNormalizeCSS>
        <Dashboard />
      </MantineProvider>
      <Toaster />
    </>
  );
}
