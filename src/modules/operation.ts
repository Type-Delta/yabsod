type Awaitable<T> = T | PromiseLike<T>;
type TaskEntry<T> = Awaitable<T> | (() => Awaitable<T>);
type TaskResult<T> = T extends () => infer R ? Awaited<R> : Awaited<T>;

/**
 * Executes multiple asynchronous tasks with a specified concurrency limit.
 * Tasks can be provided as an array of functions returning promises or as an array of direct promise-like values.
 *
 * @param items - An array of items to process or an array of functions that return promises.
 * @param fn - An optional mapping function to apply to each item if `items` is not already an array of functions.
 * @param concurrency - The maximum number of tasks to run concurrently. If not provided, all tasks will run in parallel.
 * @returns A promise that resolves to an array of results corresponding to the input tasks, preserving the original order.
 * @throws If any of the tasks reject, the returned promise will reject with the first encountered error.
 */
export async function conncurrent<T, Item>(
   items: readonly Item[],
   fn: (item: Item) => Awaitable<T>,
   concurrency?: number
): Promise<T[]>;
/**
 * Executes multiple asynchronous tasks with a specified concurrency limit.
 * Tasks can be provided as an array of functions returning promises or as an array of direct promise-like values.
 *
 * @param tasks - An array of functions that return promises or direct promise-like values to execute.
 * @param concurrency - The maximum number of tasks to run concurrently. If not provided, all tasks will run in parallel.
 * @returns A promise that resolves to an array of results corresponding to the input tasks, preserving the original order.
 * @throws If any of the tasks reject, the returned promise will reject with the first encountered error.
 */
export async function conncurrent<const T extends readonly unknown[] | []>(
   tasks: T,
   concurrency?: number
): Promise<{ -readonly [P in keyof T]: TaskResult<T[P]> }>;
export async function conncurrent<T, Item>(
   itemsOrTasks: readonly Item[] | readonly TaskEntry<T>[],
   fnOrConcurrency?: ((item: Item) => Awaitable<T>) | number,
   maybeConcurrency?: number
): Promise<unknown[]> {
   const usingMapper = typeof fnOrConcurrency === 'function';
   const input = itemsOrTasks as readonly unknown[];
   const total = input.length;

   if (total === 0) {
      return [];
   }

   const rawConcurrency = usingMapper ? maybeConcurrency : fnOrConcurrency;
   const resolvedConcurrency =
      rawConcurrency == null ? total : Math.floor(Number(rawConcurrency));

   if (!Number.isFinite(resolvedConcurrency) || resolvedConcurrency < 1) {
      throw new RangeError('concurrency must be a positive finite number');
   }

   const workerCount = Math.min(total, resolvedConcurrency);
   const results: unknown[] = new Array(total);
   const mapper = usingMapper ? (fnOrConcurrency as (item: Item) => Awaitable<T>) : null;
   let nextIndex = 0;
   let settled = 0;
   let isRejected = false;

   return await new Promise<unknown[]>((resolve, reject) => {
      const runWorker = async () => {
         while (!isRejected) {
            const currentIndex = nextIndex;
            nextIndex += 1;

            if (currentIndex >= total) {
               return;
            }

            try {
               const current = input[currentIndex];
               const value = mapper
                  ? await mapper(current as Item)
                  : typeof current === 'function'
                     ? await (current as () => Awaitable<unknown>)()
                     : await current;

               results[currentIndex] = value;
               settled += 1;

               if (settled === total) {
                  resolve(results);
                  return;
               }
            } catch (error) {
               isRejected = true;
               reject(error);
               return;
            }
         }
      };

      for (let i = 0; i < workerCount; i += 1) {
         void runWorker();
      }
   });
}
