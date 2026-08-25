import { loadEnvironment } from './loadEnvironment.js';
import { createChatbotRequestHandler, createRuntimeServices } from './chatbotServer.js';

let handlerPromise;

async function runtimeHandler() {
  if (!handlerPromise) {
    handlerPromise = (async () => {
      loadEnvironment();
      const runtime = await createRuntimeServices();
      return createChatbotRequestHandler(runtime);
    })();
  }
  return handlerPromise;
}

export function createVercelHandler(expectedPath) {
  return async function vercelHandler(request, response) {
    const url = new URL(request.url, 'http://localhost');
    request.url = `${expectedPath}${url.search}`;
    const handler = await runtimeHandler();
    return handler(request, response);
  };
}
