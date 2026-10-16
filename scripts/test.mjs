import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import ts from "typescript";

// Compile only the framework-independent modules used by these behavior tests.
// This works with the existing Node >=22.13 requirement and adds no dependency.
const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = await mkdtemp(path.join(tmpdir(), "collision-tests-"));
const files = ["lib/calibration.ts", "lib/sample-buffer.ts", "lib/trial-metrics.ts", "lib/trial-history.ts", "db/index.ts",
  "app/api/camera/route.ts", "app/api/trials/[id]/route.ts"];
try {
  await writeFile(path.join(temporary, "package.json"), '{"type":"module"}');
  for (const file of files) {
    const source = await readFile(path.join(root, file), "utf8");
    const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
    const output = compiled.replace(/from "@\/([^"\n]+)"/g, (_, name) => {
      const relative = name === "db" ? "db/index.js" : `${name}.js`;
      return `from ${JSON.stringify(pathToFileURL(path.join(temporary, relative)).href)}`;
    });
    const destination = path.join(temporary, file.replace(/\.ts$/, ".js"));
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, output);
  }
  const result = spawnSync(process.execPath, ["--test", "tests/behavior.test.mjs"], {
    cwd: root, stdio: "inherit", env: { ...process.env, COLLISION_TEST_BUILD: temporary },
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally { await rm(temporary, { recursive: true, force: true }); }
