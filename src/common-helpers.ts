import { Request } from "express";
import { createHash } from "node:crypto";
import { flip, pickBy, xprod } from "ramda";
import { z } from "zod";
import { CommonConfig, InputSource, InputSources } from "./config-type";
import { AbstractLogger } from "./logger";
import { AuxMethod, Method } from "./method";
import { mimeMultipart } from "./mime";

export type FlatObject = Record<string, unknown>;

const areFilesAvailable = (request: Request): boolean => {
  const contentType = request.header("content-type") || "";
  const isMultipart = contentType.toLowerCase().startsWith(mimeMultipart);
  return "files" in request && isMultipart;
};

export const defaultInputSources: InputSources = {
  get: ["query", "params"],
  post: ["body", "params", "files"],
  put: ["body", "params"],
  patch: ["body", "params"],
  delete: ["query", "params"],
};
const fallbackInputSource: InputSource[] = ["body", "query", "params"];

export const getActualMethod = (request: Request) =>
  request.method.toLowerCase() as Method | AuxMethod;

export const isCustomHeader = (name: string): name is `x-${string}` =>
  name.startsWith("x-");

/** @see https://nodejs.org/api/http.html#messageheaders */
export const getCustomHeaders = (headers: FlatObject): FlatObject =>
  pickBy(flip(isCustomHeader), headers); // needs flip to address the keys

export const getInput = (
  req: Request,
  userDefined: CommonConfig["inputSources"] = {},
): FlatObject => {
  const method = getActualMethod(req);
  if (method === "options") {
    return {};
  }
  return (
    userDefined[method] ||
    defaultInputSources[method] ||
    fallbackInputSource
  )
    .filter((src) => (src === "files" ? areFilesAvailable(req) : true))
    .map((src) => (src === "headers" ? getCustomHeaders(req[src]) : req[src]))
    .reduce<FlatObject>((agg, obj) => ({ ...agg, ...obj }), {});
};

export const makeErrorFromAnything = (subject: unknown): Error =>
  subject instanceof Error
    ? subject
    : new Error(
        typeof subject === "symbol" ? subject.toString() : `${subject}`,
      );

export const logInternalError = ({
  logger,
  request,
  input,
  error,
  statusCode,
}: {
  logger: AbstractLogger;
  request: Request;
  input: FlatObject | null;
  error: Error;
  statusCode: number;
}) => {
  if (statusCode === 500) {
    logger.error(`Internal server error\n${error.stack}\n`, {
      url: request.url,
      payload: input,
    });
  }
};

export const combinations = <T>(
  a: T[],
  b: T[],
  merge: (pair: [T, T]) => T,
): T[] => (a.length && b.length ? xprod(a, b).map(merge) : a.concat(b));

/**
 * @desc isNullable() and isOptional() validate the schema's input
 * @desc They always return true in case of coercion, which should be taken into account when depicting response
 */
export const hasCoercion = (schema: z.ZodTypeAny): boolean =>
  "coerce" in schema._def && typeof schema._def.coerce === "boolean"
    ? schema._def.coerce
    : false;

export const ucFirst = (subject: string) =>
  subject.charAt(0).toUpperCase() + subject.slice(1).toLowerCase();

export const makeCleanId = (...args: string[]) =>
  args
    .flatMap((entry) => entry.split(/[^A-Z0-9]/gi)) // split by non-alphanumeric characters
    .flatMap((entry) =>
      // split by sequences of capitalized letters
      entry.replaceAll(/[A-Z]+/g, (beginning) => `/${beginning}`).split("/"),
    )
    .map(ucFirst)
    .join("");

export const defaultSerializer = (schema: z.ZodTypeAny): string =>
  createHash("sha1").update(JSON.stringify(schema), "utf8").digest("hex");

export const tryToTransform = <T>(
  schema: z.ZodEffects<z.ZodTypeAny, T>,
  sample: T,
) => {
  try {
    return typeof schema.parse(sample);
  } catch (e) {
    return undefined;
  }
};

/** @desc can still be an array, use R.complement(Array.isArray) to exclude that case */
export const isObject = (subject: unknown): subject is object =>
  typeof subject === "object" && subject !== null;
