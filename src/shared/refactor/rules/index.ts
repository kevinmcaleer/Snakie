/**
 * The refactoring catalogue (epic #634 §3) — every rule the engine knows about.
 *
 * Grouped by the phase that shipped them, so the list reads like the epic and a
 * rule's home is obvious. The number beside each is its **catalogue number** in
 * §3 of the epic, which is the stable way to talk about a rule across the issue,
 * the tests and the help articles.
 *
 * Adding a rule means writing `rules/<id>.ts` and a
 * `test/fixtures/refactor/<id>/` folder, then adding one line here; the
 * table-driven golden suite picks the rest up automatically and will fail if a
 * registered rule has no fixtures, and the help suite will fail if it has no
 * "Why?" article.
 */
import type { RefactorRule } from '../types'


// R0/R1 — nesting & control flow (§3.1, §3.8)
import { guardClauseRule } from './guard-clause' // 1
import { mergeNestedConditionsRule } from './merge-nested-conditions' // 2
import { removeRedundantElseRule } from './remove-redundant-else' // 3
import { continueGuardRule } from './continue-guard' // 4
import { deepNestingRule } from './deep-nesting' // 5
import { returnTheExpressionRule } from './return-the-expression' // 6
import { deMorganRule } from './de-morgan' // 7
import { collapseElifRule } from './collapse-elif' // 64
import { liftBreakIntoWhileRule } from './lift-break-into-while' // 65
import { unreachableCodeRule } from './unreachable-code' // 66
import { identicalBranchesRule } from './identical-branches' // 67

// R2 — extraction & renaming (§3.2, #451)
import { extractFunctionRule } from './extract-function' // 8
import { extractVariableRule } from './extract-variable' // 9
import { inlineVariableRule } from './inline-variable' // 10
import { longFunctionRule } from './long-function' // 11
import { duplicateBlockRule } from './duplicate-block' // 12
import { renameSymbolRule } from './rename-symbol' // 90

// R3 — conditionals & constants (§3.3, §3.8)
import { dictDispatchRule } from './dict-dispatch' // 13
import { namedConstantRule } from './named-constant' // 14
import { booleanParameterTrapRule } from './boolean-parameter-trap' // 15
import { simplifyComparisonRule } from './simplify-comparison' // 16
import { simplifyTruthinessRule } from './simplify-truthiness' // 17
import { conditionalExpressionRule } from './conditional-expression' // 68
import { chainedComparisonRule } from './chained-comparison' // 69
import { isinstanceTupleRule } from './isinstance-tuple' // 70
import { membershipTestRule } from './membership-test' // 71
import { dictGetDefaultRule } from './dict-get-default' // 72

// R4 — loops & data (§3.4, §3.8)
import { iterateDirectlyRule } from './iterate-directly' // 18
import { useComprehensionRule } from './use-comprehension' // 19
import { useSumRule } from './use-sum' // 20
import { hoistLoopInvariantRule } from './hoist-loop-invariant' // 21
import { joinStringsRule } from './join-strings' // 22
import { useZipRule } from './use-zip' // 23
import { tupleSwapRule } from './tuple-swap' // 73
import { tupleUnpackingRule } from './tuple-unpacking' // 74
import { iterateDictItemsRule } from './iterate-dict-items' // 75
import { useMinMaxRule } from './use-min-max' // 76
import { whileCounterToForRule } from './while-counter-to-for' // 77

// R5 — functions, classes & resources (§3.5, §3.8)
import { mutableDefaultRule } from './mutable-default' // 24
import { parameterObjectRule } from './parameter-object' // 25
import { usePropertyRule } from './use-property' // 26
import { statelessClassRule } from './stateless-class' // 27
import { generateReprRule } from './generate-repr' // 28
import { useWithRule } from './use-with' // 29
import { specificExceptionRule } from './specific-exception' // 30
import { eafpOpenRule } from './eafp-open' // 31
import { ruffOwnedUnusedRule } from './ruff-owned-unused' // 32
import { useFStringRule } from './use-fstring' // 78
import { exceptPassRule } from './except-pass' // 79

// R6 — MicroPython-specific (§3.6, §3.8) — the differentiator
import { nonBlockingLoopRule } from './non-blocking-loop' // 33
import { constWrapRule } from './const-wrap' // 34
import { hoistHardwareConstructionRule } from './hoist-hardware-construction' // 35
import { isrAllocationRule } from './isr-allocation' // 36
import { unboundedLogRule } from './unbounded-log' // 37
import { gateDebugPrintRule } from './gate-debug-print' // 38
import { awaitAsyncioSleepRule } from './await-asyncio-sleep' // 39
import { integerAccumulatorRule } from './integer-accumulator' // 40
import { cachePinObjectRule } from './cache-pin-object' // 41
import { largeModuleTableRule } from './large-module-table' // 42
import { emergencyExceptionBufRule } from './emergency-exception-buf' // 56
import { ticksDiffRule } from './ticks-diff' // 80
import { sleepMsRule } from './sleep-ms' // 81
import { cacheLookupInLoopRule } from './cache-lookup-in-loop' // 82
import { bindGlobalToLocalRule } from './bind-global-to-local' // 83
import { busyWaitRule } from './busy-wait' // 84
import { packIntoBufferRule } from './pack-into-buffer' // 85
import { dropUModuleShimRule } from './drop-u-module-shim' // 86
import { batchFileWritesRule } from './batch-file-writes' // 87
import { integerDivisionRule } from './integer-division' // 88
import { timerCallbackAllocationRule } from './timer-callback-allocation' // 89

// R6b — board-specific optimisation (§3.7)
import { tryNativeEmitterRule } from './try-native-emitter' // 43
import { convertToViperRule } from './convert-to-viper' // 44
import { pioNeopixelRule } from './pio-neopixel' // 49
import { pioEncoderRule } from './pio-encoder' // 50
import { readIntoBufferRule } from './readinto-buffer' // 57
import { memoryviewSliceRule } from './memoryview-slice' // 58
import { freezeLargeTableRule } from './freeze-large-table' // 62
import { crossCompileMpyRule } from './cross-compile-mpy' // 63

/** §3.1 + §3.8 — nesting & control flow. The headline family. */
export const CONTROL_FLOW_RULES: RefactorRule<unknown>[] = [
  guardClauseRule,
  mergeNestedConditionsRule,
  removeRedundantElseRule,
  continueGuardRule,
  deepNestingRule,
  returnTheExpressionRule,
  deMorganRule,
  collapseElifRule,
  liftBreakIntoWhileRule,
  unreachableCodeRule,
  identicalBranchesRule
]

/** §3.2 + #451 — extracting and naming. The hardest analysis in the epic:
 * these are the rules that need real read/write scope information. */
export const EXTRACTION_RULES: RefactorRule<unknown>[] = [
  extractFunctionRule,
  extractVariableRule,
  inlineVariableRule,
  longFunctionRule,
  duplicateBlockRule,
  renameSymbolRule
]

/** §3.3 + §3.8 — conditionals & constants. */
export const CONDITIONAL_RULES: RefactorRule<unknown>[] = [
  dictDispatchRule,
  namedConstantRule,
  booleanParameterTrapRule,
  simplifyComparisonRule,
  simplifyTruthinessRule,
  conditionalExpressionRule,
  chainedComparisonRule,
  isinstanceTupleRule,
  membershipTestRule,
  dictGetDefaultRule
]

/** §3.4 + §3.8 — loops & data. */
export const LOOP_RULES: RefactorRule<unknown>[] = [
  iterateDirectlyRule,
  useComprehensionRule,
  useSumRule,
  hoistLoopInvariantRule,
  joinStringsRule,
  useZipRule,
  tupleSwapRule,
  tupleUnpackingRule,
  iterateDictItemsRule,
  useMinMaxRule,
  whileCounterToForRule
]

/** §3.5 + §3.8 — functions, classes & resources. */
export const FUNCTION_RULES: RefactorRule<unknown>[] = [
  mutableDefaultRule,
  parameterObjectRule,
  usePropertyRule,
  statelessClassRule,
  generateReprRule,
  useWithRule,
  specificExceptionRule,
  eafpOpenRule,
  ruffOwnedUnusedRule,
  useFStringRule,
  exceptPassRule
]

/** §3.6 + §3.8 — MicroPython-specific. Nothing else on the market offers
 * these, and they are the ones that actually make a robot work better.
 * Several are latent bugs rather than style opinions (a raw tick subtraction
 * WILL misbehave when the counter wraps), which is why this family's hints
 * are on by default. */
export const MICROPYTHON_RULES: RefactorRule<unknown>[] = [
  nonBlockingLoopRule,
  constWrapRule,
  hoistHardwareConstructionRule,
  isrAllocationRule,
  unboundedLogRule,
  gateDebugPrintRule,
  awaitAsyncioSleepRule,
  integerAccumulatorRule,
  cachePinObjectRule,
  largeModuleTableRule,
  emergencyExceptionBufRule,
  ticksDiffRule,
  sleepMsRule,
  cacheLookupInLoopRule,
  bindGlobalToLocalRule,
  busyWaitRule,
  packIntoBufferRule,
  dropUModuleShimRule,
  batchFileWritesRule,
  integerDivisionRule,
  timerCallbackAllocationRule
]

/** §3.7 — board-specific optimisation. Every rule here carries a `requires`
 * gate, so it is offered ONLY when a board is connected and its firmware has
 * been asked what it actually supports. No board means no board advice. */
export const BOARD_RULES: RefactorRule<unknown>[] = [
  tryNativeEmitterRule,
  convertToViperRule,
  pioNeopixelRule,
  pioEncoderRule,
  readIntoBufferRule,
  memoryviewSliceRule,
  freezeLargeTableRule,
  crossCompileMpyRule
]

/** Everything, grouped by family. */
export const ALL_RULES: RefactorRule<unknown>[] = [
  ...CONTROL_FLOW_RULES,
  ...EXTRACTION_RULES,
  ...CONDITIONAL_RULES,
  ...LOOP_RULES,
  ...FUNCTION_RULES,
  ...MICROPYTHON_RULES,
  ...BOARD_RULES
]

/** Look a rule up by id. */
export function ruleById(id: string): RefactorRule<unknown> | undefined {
  return ALL_RULES.find((r) => r.id === id)
}

/** Look a rule up by its catalogue number in epic #634 §3. */
export function ruleByCatalogue(n: number): RefactorRule<unknown> | undefined {
  return ALL_RULES.find((r) => r.catalogue === n)
}

/**
 * The provably-safe subset "Tidy this file" (R7) is allowed to batch. Anything
 * that trades safety, RAM or portability for speed — or that needs a human to
 * judge intent — is excluded by its own `safe: false`.
 */
export function safeRules(): RefactorRule<unknown>[] {
  return ALL_RULES.filter((r) => r.safe && !r.hintOnly)
}
