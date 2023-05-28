import React, { useEffect } from "react";

import ReconnectingWebSocket from "reconnecting-websocket";

const rws = new ReconnectingWebSocket("ws://talkie:3000");

rws.addEventListener("open", () => {
  rws.send("hello!");
});

rws.addEventListener("message", (event) => {
  console.log("Got data from pi!", event.data);
});

rws.addEventListener("close", (event) => {
  console.log("Connection closed!");
});

rws.addEventListener("error", (event) => {
  console.log("Connection closed!");
});

export function App() {
  useEffect(() => {
    console.log("Hello world!");
  }, []);
  return <h1>Hello world!</h1>;
}
