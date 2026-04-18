const pino = require("pino");

function createLogger() {
  const level = process.env.LOG_LEVEL || "info";
  const pretty = process.env.LOG_PRETTY !== "0";

  return pino({
    level,
    transport: pretty
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            ignore: "pid,hostname",
          },
        }
      : undefined,
  });
}

module.exports = {
  createLogger,
};
