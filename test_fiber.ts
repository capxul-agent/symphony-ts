import { Effect, Fiber } from "effect";

async function main() {
  console.log("[test] Starting fiber test...");
  
  const program = Effect.gen(function* () {
    const fiber = yield* Effect.fork(
      Effect.gen(function* () {
        console.log("[inner] Starting long running task...");
        yield* Effect.sleep("60 seconds");
        console.log("[inner] Task completed!");
        return "done";
      })
    );
    
    console.log("[outer] Fiber forked, waiting...");
    yield* Effect.sleep("2 seconds");
    console.log("[outer] Checking if fiber is still running...");
    
    // Try to join with timeout
    const result = yield* Fiber.join(fiber).pipe(
      Effect.timeout("5 seconds"),
      Effect.catchAll((e) => {
        console.log("[outer] Timeout or error:", e);
        return Effect.succeed("timeout");
      })
    );
    
    console.log("[outer] Result:", result);
  });
  
  await Effect.runPromise(program);
  console.log("[test] Done");
}

main().catch(console.error);
