import { writeFile } from "node:fs/promises";
import { Integration } from "../src";
import { routing } from "./routing";
import { config } from "./config";

await writeFile(
  "example/example.client.ts",
  // or just: new Integration({ routing }).print(),
  await new Integration({ routing, config }).printFormatted(),
  "utf-8",
);
