import { TEST_WORKER_PATH } from './mp-worker'

// Point the (worker-thread-backed) MicroPython runtime at the worker that
// globalSetup compiled, so integration tests spawn a real interpreter. Runs in
// each test worker before its file loads; globalSetup (main process) can't set
// env across the process boundary, so we set it here.
process.env.SNAKIE_MP_WORKER ??= TEST_WORKER_PATH
