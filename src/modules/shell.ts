import { execa } from 'execa';

import { DEFAULT_SPINNER } from '@/consts';
import { SpinnerOptions } from '@/types';
import { ncc } from '@lib/Tools';

export const terminalWidth = process.stdout.columns || 100;

export interface SpinnerContoller {
   stop: () => void;
   start: (newline?: boolean) => void;
   setMessage: (msg: string) => void;
   options: Required<SpinnerOptions>;
}

/**
 * Creates an animated spinner that displays in the terminal.
 *
 * Animation will immediately start unless no message is provided (quiet mode).
 * in this mode you will have to call `resume()` to start the spinner.
 *
 * @param options - Configuration options for the spinner
 * @returns An object with `stop()` method to halt the spinner and restore stdout
 *
 * @example
 * const spinnerCtrl = spinner({ message: 'Loading...' });
 * // ... do work ...
 * spinnerCtrl.stop();
 */
export function spinner(options: SpinnerOptions = {}): SpinnerContoller {
   const isQuietStart = !options.message;
   options = {
      message: '',
      interval: 70,
      frames: DEFAULT_SPINNER as string[],
      ...options,
   } satisfies Required<SpinnerOptions>;

   if (!process.stdout.isTTY) {
      return {
         stop: () => {
            /* no-op */
         },
         start: (newline = true) => {
            if (newline) process.stdout.write('\n');
         },
         // eslint-disable-next-line @typescript-eslint/no-unused-vars
         setMessage: (msg: string) => { },
         options: options as Required<SpinnerOptions>,
      };
   }

   let frameIndex = 0;
   let isRunning = true;
   let intervalId: NodeJS.Timeout | null = null;

   const render = () => {
      if (!isRunning) return;

      // Draw spinner frame
      let frame = options.frames![frameIndex % options.frames!.length];

      // Draw message
      if (options.message) {
         frame += ' ' + options.message;
      }

      // Clear the current line and move cursor to start then write frame
      process.stdout.write('\r\x1b[K' + frame);
      frameIndex++;
   };

   // Start the animation loop only if not quiet
   if (!isQuietStart) {
      intervalId = setInterval(render, options.interval);
      // Hide cursor
      process.stdout.write('\x1b[?25l');
      render(); // Initial render
   }

   return {
      /**
       * Stops the spinner and cleans up
       */
      stop: () => {
         isRunning = false;
         if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
         }
         // Clear line and show cursor
         process.stdout.write('\r\x1b[K\x1b[?25h');
      },
      /**
       * Resumes the spinner if it was stopped
       */
      start: (newline = true) => {
         if (!isRunning) {
            // Hide cursor then add a new line if requested
            process.stdout.write('\x1b[?25l' + (newline ? '\n' : ''));

            // Restart animation loop
            isRunning = true;
            intervalId = setInterval(render, options.interval);
         }
      },
      setMessage: (msg: string) => {
         options.message = msg;
         render(); // Force re-render to update message immediately
      },
      /**
       * Spinner options reference
       */
      options: options as Required<SpinnerOptions>,
   };
}

export async function runCommand(command: string, args: string[], input?: string): Promise<string> {
   const { stdout } = await execa(command, args, {
      input,
      windowsHide: true,
      stderr: 'pipe',
   });

   return stdout;
}

export function quickPrint(message: string): void {
   process.stdout.write(`${message}\n`);
}

export function info(message: string): void {
   process.stdout.write(`${ncc('Green')}[info]${ncc()} ${message}\n`);
}

export function warn(message: string): void {
   process.stderr.write(`${ncc('Yellow')}[warn]${ncc()} ${message}\n`);
}

export function error(message: string): void {
   process.stderr.write(`${ncc('Red')}[error]${ncc()} ${message}\n`);
}
