// Tries fn up to `tries` times, waiting longer each time (1 s, 2 s, ...): a mail server or API that hiccups for a
// moment shouldn't cost a customer their reminder. The last error is thrown if every try fails.
export async function retry(fn, { tries = 3, base = 1000, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= tries) throw error;
      await wait(base * 2 ** (attempt - 1));
    }
  }
}
