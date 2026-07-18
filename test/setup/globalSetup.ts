import { build } from 'esbuild'
import { rm } from 'fs/promises'
import { TEST_WORKER_PATH, WORKER_ENTRY } from './mp-worker'

/** Vitest globalSetup: compile the sim worker once for the whole run. */
export async function setup(): Promise<void> {
  await build({
    entryPoints: [WORKER_ENTRY],
    bundle: true,
    platform: 'node',
    format: 'esm',
    external: ['@micropython/*'],
    outfile: TEST_WORKER_PATH
  })
}

export async function teardown(): Promise<void> {
  await rm(TEST_WORKER_PATH, { force: true })
}
