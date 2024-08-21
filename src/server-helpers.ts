import type fileUpload from "express-fileupload";
import { metaSymbol } from "./metadata";
import { loadPeer } from "./peer-helpers";
import { AbstractResultHandler } from "./result-handler";
import { ActualLogger } from "./logger-helpers";
import { CommonConfig, ServerConfig } from "./config-type";
import { ErrorRequestHandler, RequestHandler, Response } from "express";
import createHttpError, { isHttpError } from "http-errors";
import { lastResortHandler } from "./last-resort";
import { ResultHandlerError } from "./errors";
import { makeErrorFromAnything } from "./common-helpers";

export type LocalResponse = Response<
  unknown,
  { [metaSymbol]?: { logger: ActualLogger } }
>;

export type LoggerExtractor = (response: LocalResponse) => ActualLogger;

interface HandlerCreatorParams {
  errorHandler: AbstractResultHandler;
  getLogger: LoggerExtractor;
}

export const createParserFailureHandler =
  ({ errorHandler, getLogger }: HandlerCreatorParams): ErrorRequestHandler =>
  async (error, request, response, next) => {
    if (!error) {
      return next();
    }
    errorHandler.execute({
      error: isHttpError(error)
        ? error
        : createHttpError(400, makeErrorFromAnything(error).message),
      request,
      response,
      input: null,
      output: null,
      options: {},
      logger: getLogger(response),
    });
  };

export const createNotFoundHandler =
  ({ errorHandler, getLogger }: HandlerCreatorParams): RequestHandler =>
  async (request, response) => {
    const error = createHttpError(
      404,
      `Can not ${request.method} ${request.path}`,
    );
    const logger = getLogger(response);
    try {
      errorHandler.execute({
        request,
        response,
        logger,
        error,
        input: null,
        output: null,
        options: {},
      });
    } catch (e) {
      lastResortHandler({
        response,
        logger,
        error: new ResultHandlerError(makeErrorFromAnything(e).message, error),
      });
    }
  };

export const createUploadFailueHandler =
  (error: Error): RequestHandler =>
  (req, {}, next) => {
    const failedFile = Object.values(req?.files || [])
      .flat()
      .find(({ truncated }) => truncated);
    if (failedFile) {
      return next(error);
    }
    next();
  };

export const createUploadLogger = (
  logger: ActualLogger,
): Pick<Console, "log"> => ({
  log: logger.debug.bind(logger),
});

export const createUploadParsers = async ({
  getLogger,
  config,
}: {
  getLogger: LoggerExtractor;
  config: ServerConfig;
}): Promise<RequestHandler[]> => {
  const uploader = await loadPeer<typeof fileUpload>("express-fileupload");
  const { limitError, beforeUpload, ...options } = {
    ...(typeof config.server.upload === "object" && config.server.upload),
  };
  const parsers: RequestHandler[] = [];
  parsers.push(async (request, response, next) => {
    const logger = getLogger(response);
    try {
      await beforeUpload?.({ request, logger });
    } catch (error) {
      return next(error);
    }
    uploader({
      debug: true,
      ...options,
      abortOnLimit: false,
      parseNested: true,
      logger: createUploadLogger(logger),
    })(request, response, next);
  });
  if (limitError) {
    parsers.push(createUploadFailueHandler(limitError));
  }
  return parsers;
};

export const moveRaw: RequestHandler = (req, {}, next) => {
  if (Buffer.isBuffer(req.body)) {
    req.body = { raw: req.body };
  }
  next();
};

/** @since v19 prints the actual path of the request, not a configured route, severity decreased to debug level */
export const createLoggingMiddleware =
  ({
    rootLogger,
    config,
  }: {
    rootLogger: ActualLogger;
    config: CommonConfig;
  }): RequestHandler =>
  async (request, response: LocalResponse, next) => {
    const logger = config.childLoggerProvider
      ? await config.childLoggerProvider({ request, parent: rootLogger })
      : rootLogger;
    logger.debug(`${request.method}: ${request.path}`);
    response.locals[metaSymbol] = { logger };
    next();
  };

export const makeLoggerExtrator =
  (fallback: ActualLogger): LoggerExtractor =>
  (response) =>
    response.locals[metaSymbol]?.logger || fallback;
