import { Effect, Fiber } from "effect";

async function main() {
  console.log("[test] Starting fiber test...");
  
  const program = Effect.gen(function* () {
    const fiber = yield* Effect.fork(
      Effect.gen(function* () {
        console.log("[inner] Starting task...");
        yield* Effect.sleep("3 seconds");
        console.log("[inner] Task completed!");
        return "done";
      })
    );
    
    console.log("[outer] Fiber forked, waiting for join...");
    const result = yield* Fiber.join(fiber);
    console.log("[outer] Joined! Result:", result);
  });
  
  await Effect.runPromise(program);
  console.log("[test] Done");
}

main().catch(console.error);
