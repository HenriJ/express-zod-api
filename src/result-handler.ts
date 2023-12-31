import { Request, Response } from "express";
import { z } from "zod";
import { ApiResponse, MultipleApiResponses } from "./api-response";
import {
  FlatObject,
  getExamples,
  getMessageFromError,
  getStatusCodeFromError,
  logInternalError,
} from "./common-helpers";
import { IOSchema } from "./io-schema";
import { AbstractLogger } from "./logger";
import { withMeta } from "./metadata";

interface ResultHandlerParams<RES> {
  /** null in case of failure to parse or to find the matching endpoint (error: not found) */
  input: FlatObject | null;
  /** null in case of errors or failures */
  output: FlatObject | null;
  error: Error | null;
  request: Request;
  response: Response<RES>;
  logger: AbstractLogger;
}

export type ResultHandler<RES> = (
  params: ResultHandlerParams<RES>,
) => void | Promise<void>;

export interface ResultHandlerDefinition<
  POS extends z.ZodTypeAny,
  NEG extends z.ZodTypeAny,
> {
  getPositiveResponse: (output: IOSchema) => POS | ApiResponse<POS>;
  getNegativeResponse: () => NEG | ApiResponse<NEG>;
  handler: ResultHandler<z.output<POS> | z.output<NEG>>;
}

interface StatusDependingDefinition<
  POS extends MultipleApiResponses,
  NEG extends MultipleApiResponses,
> {
  getPositiveResponse: (output: IOSchema) => POS;
  getNegativeResponse: () => NEG;
  handler: ResultHandler<
    z.output<POS[number]["schema"]> | z.output<NEG[number]["schema"]>
  >;
}

export type AnyResultHandlerDefinition =
  | ResultHandlerDefinition<z.ZodTypeAny, z.ZodTypeAny>
  | StatusDependingDefinition<MultipleApiResponses, MultipleApiResponses>;

export const defaultStatusCodes = {
  positive: 200,
  negative: 400,
};

export function createResultHandler<
  POS extends MultipleApiResponses,
  NEG extends MultipleApiResponses,
>(definition: StatusDependingDefinition<POS, NEG>): typeof definition;

export function createResultHandler<
  POS extends z.ZodTypeAny,
  NEG extends z.ZodTypeAny,
>(definition: ResultHandlerDefinition<POS, NEG>): typeof definition;

export function createResultHandler(definition: unknown) {
  return definition;
}

/** @todo remove */
createResultHandler({
  getPositiveResponse: () => [
    { statusCode: 200, schema: z.literal("ok") },
    { statusCode: 201, schema: z.literal("kinda") },
  ],
  getNegativeResponse: () => [
    { statusCode: 400, schema: z.literal("error") },
    { statusCode: 500, schema: z.literal("failure") },
  ],
  handler: ({ response }) => {
    response.status(200).send("error");
  },
});

export const defaultResultHandler = createResultHandler({
  getPositiveResponse: (output: IOSchema) => {
    // Examples are taken for proxying: no validation needed for this
    const examples = getExamples({ schema: output });
    const responseSchema = withMeta(
      z.object({
        status: z.literal("success"),
        data: output,
      }),
    );
    return examples.reduce<typeof responseSchema>(
      (acc, example) =>
        acc.example({
          status: "success",
          data: example,
        }),
      responseSchema,
    );
  },
  getNegativeResponse: () =>
    withMeta(
      z.object({
        status: z.literal("error"),
        error: z.object({
          message: z.string(),
        }),
      }),
    ).example({
      status: "error",
      error: {
        message: getMessageFromError(new Error("Sample error message")),
      },
    }),
  handler: ({ error, input, output, request, response, logger }) => {
    if (!error) {
      response.status(defaultStatusCodes.positive).json({
        status: "success",
        data: output,
      });
      return;
    }
    const statusCode = getStatusCodeFromError(error);
    logInternalError({ logger, statusCode, request, error, input });
    response.status(statusCode).json({
      status: "error",
      error: { message: getMessageFromError(error) },
    });
  },
});

/**
 * @deprecated Resist the urge of using it: this handler is designed only to simplify the migration of legacy APIs.
 * @desc Responding with array is a bad practice keeping your endpoints from evolving without breaking changes.
 * @desc This handler expects your endpoint to have the property 'items' in the output object schema
 * */
export const arrayResultHandler = createResultHandler({
  getPositiveResponse: (output) => {
    // Examples are taken for proxying: no validation needed for this
    const examples = getExamples({ schema: output });
    const responseSchema = withMeta(
      "shape" in output &&
        "items" in output.shape &&
        output.shape.items instanceof z.ZodArray
        ? (output.shape.items as z.ZodArray<z.ZodTypeAny>)
        : z.array(z.any()),
    );
    return examples.reduce<typeof responseSchema>(
      (acc, example) =>
        typeof example === "object" &&
        example !== null &&
        "items" in example &&
        Array.isArray(example.items)
          ? acc.example(example.items)
          : acc,
      responseSchema,
    );
  },
  getNegativeResponse: () =>
    withMeta(z.string()).example(
      getMessageFromError(new Error("Sample error message")),
    ),
  handler: ({ response, output, error, logger, request, input }) => {
    if (error) {
      const statusCode = getStatusCodeFromError(error);
      logInternalError({ logger, statusCode, request, error, input });
      response.status(statusCode).send(error.message);
      return;
    }
    if (output && "items" in output && Array.isArray(output.items)) {
      response.status(defaultStatusCodes.positive).json(output.items);
    } else {
      response
        .status(500)
        .send("Property 'items' is missing in the endpoint output");
    }
  },
});
