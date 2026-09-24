import { dashscopeImageModel, dashscopeTextModel, loadDotEnv } from "./env";
import { createAgentFromEnv } from "./agent";
import { createA2UIServer } from "./a2ui-server";
import { createApp } from "./app";
import { createChatFromEnv } from "./chat/openai-chat";
import { guardSocketDisconnect, installProcessDisconnectGuard } from "./ag-ui";

loadDotEnv();
installProcessDisconnectGuard();

const port = Number(process.env.PORT ?? 3000);
const agent = createAgentFromEnv();
const chat = createChatFromEnv();
const a2ui = createA2UIServer({ agent });
const app = createApp(a2ui, { chat });

const server = app.listen(port, () => {
  const textModel = agent.kind === "dashscope" ? dashscopeTextModel() : (process.env.OPENAI_MODEL ?? "");
  const agentLabel = textModel ? `${agent.kind}/${textModel}` : agent.kind;
  const chatLabel = chat ? `${chat.provider}/${chat.model}` : "off";
  const imageLabel = agent.kind === "dashscope" ? ` image=${dashscopeImageModel()}` : "";
  console.log(
    `a2ui-playground-server listening on ${port} (agent=${agentLabel}${imageLabel}, chat=${chatLabel}, ag-ui=/v1/generate)`,
  );
});

server.on("connection", (socket) => {
  guardSocketDisconnect(socket);
});

export default app;
