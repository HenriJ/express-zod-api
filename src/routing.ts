import { IRouter, RequestHandler } from "express";
import { CommonConfig } from "./config-type";
import { ContentType } from "./content-type";
import { DependsOnMethod } from "./depends-on-method";
import { AbstractEndpoint } from "./endpoint";
import { walkRouting } from "./routing-walker";
import { ServeStatic } from "./serve-static";
import { LoggerExtractor } from "./server-helpers";

export interface Routing {
  [SEGMENT: string]: Routing | DependsOnMethod | AbstractEndpoint | ServeStatic;
}

export type Parsers = Record<ContentType, RequestHandler[]>;

export const initRouting = ({
  app,
  getLogger,
  config,
  routing,
  parsers,
}: {
  app: IRouter;
  getLogger: LoggerExtractor;
  config: CommonConfig;
  routing: Routing;
  parsers?: Parsers;
}) =>
  walkRouting({
    routing,
    hasCors: !!config.cors,
    onEndpoint: (endpoint, path, method, siblingMethods) => {
      app[method](
        path,
        ...(parsers?.[endpoint.getRequestType()] || []),
        async (request, response) =>
          endpoint.execute({
            request,
            response,
            logger: getLogger(response),
            config,
            siblingMethods,
          }),
      );
    },
    onStatic: (path, handler) => {
      app.use(path, handler);
    },
  });
