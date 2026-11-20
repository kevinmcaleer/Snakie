/**
 * kevsrobots suite: the app switcher and the account button (kevsrobots.com#581).
 * =============================================================================
 * Two dependency-free web components shared by kevsrobots.com, Snakie and
 * BetterCAD, so the suite looks and behaves the same in every app:
 *
 *   <kr-app-switcher app="snakie" target="_blank"></kr-app-switcher>
 *     The 3 by 3 button. Opens a card listing Learn, Projects, Snakie and
 *     BetterCAD, with the app you are in marked. `target` is passed to the
 *     links (an editor opens the others in a new tab, so nothing unsaved is lost).
 *
 *   <kr-account app="snakie"></kr-account>
 *     Your kevsrobots account. Set `.user = { name, username, avatarUrl }` when
 *     signed in, or `null` when not. It fires `kr-sign-in` and `kr-sign-out`
 *     (bubbling, composed) and leaves signing in to the app. Put a sentence in
 *     `slot="note"` to say what signing in is for; add menu entries with
 *     `slot="items"`. The `busy` attribute disables its buttons.
 *
 * Theming: every colour reads a `--kr-*` custom property first (`--kr-ink`,
 * `--kr-ink-soft`, `--kr-line`, `--kr-panel`, `--kr-sunk`, `--kr-shadow`,
 * `--kr-accent`, `--kr-on-accent`, `--kr-focus`, `--kr-font-ui`), so an app can
 * map its own tokens onto them. Without them it uses the suite palette, light
 * or dark from `theme="light|dark"`, else the system setting.
 *
 * The canonical copy is this file, served at
 * https://www.kevsrobots.com/assets/suite/kr-suite.js. Snakie and BetterCAD
 * bundle a copy so they work offline and on the desktop: change it here first
 * and copy it across, bumping KR_SUITE_VERSION.
 */

export const KR_SUITE_VERSION = '1.1.0'

export const KR_ACCOUNT_URL = 'https://accounts.kevsrobots.com/account'

/**
 * Each app's icon, as a data URI so a bundled copy works offline. Generated
 * from icons/<id>.svg (served at https://www.kevsrobots.com/assets/suite/icons/):
 * edit the SVG, then regenerate these lines with
 * `node scripts/build-suite-icons.mjs`.
 */
export const KR_ICONS = Object.freeze({
  learn: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCIgdmlld0JveD0iMCAwIDY0IDY0Ij48cmVjdCB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHJ4PSIxNCIgZmlsbD0iI0ZGRkZGRiIvPjxyZWN0IHg9Ii41IiB5PSIuNSIgd2lkdGg9IjYzIiBoZWlnaHQ9IjYzIiByeD0iMTMuNSIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjQzIyMDMyIiBzdHJva2Utb3BhY2l0eT0iLjI1Ii8+PGltYWdlIHg9IjYiIHk9IjYiIHdpZHRoPSI1MiIgaGVpZ2h0PSI1MiIgaHJlZj0iZGF0YTppbWFnZS9wbmc7YmFzZTY0LGlWQk9SdzBLR2dvQUFBQU5TVWhFVWdBQUFFQUFBQUEvQ0FZQUFBQlFIYzdLQUFBUlRFbEVRVlJvM3NXYmUzVFYxWlhIUC92Y200UVFJRHprVmFYNWdRNG9NNHh3Z3dyaG9kWHBpTFdPbG1tckZXeUhjZHJhMnRacXJjdHhadHFxblZyRlNrVkZ5L2lvVmJEcWRFYTcxT1Z6VkJMa21ZUkMxYUlVRXdzS29oQURlZDE3Zjc4OWYrenp5OHM4N2czWTdyVlk5M0x6ZTV6OVBmdnN4M2VmSTN3TXNqRW9wMFVqbkVpUnd0SEFWT0J2L1djQWpBV0dBa1grbGpiZ0lMQVhlQXQ0SGRnS3ZDYXdPMUp0S3hiSHlYWFZSM3lzY3FRZVZCdWN4RUVORWFGSVlUSndHbkE2TUIzNEJGQUlaSUZEL2w4VGtQRzNGd0tEZ1NIK1h4SklBKzhBdGNDTHdJc0NieWlraHlMTU9FSmdIRFlBcndRcDBxb2tSSVlybkFGY0FId0tHT1VWM1E3VVlEUDZKckFIYUJCb1ZRTUVnYVRDSUdBNE1CNDREamdSbUFGTThhQzhEN3dFUENUd2Z4SGFrRVNZVTFmemx3RmdYWkFpWXc4WXBuQU84SFZnRmhBQm00RW5zRm5iN3FCUklacWI0MkNyZ2hRQ0xySm5UOEVzNmJOQU9lQ0E5Y0JkQWs4b05CWWl6QnFnUlF3SWdFb2JZREtDZWNCVndOOEJ6Y0NUd1AwQ2F6T3Fod2FKVUhHWU03UTJLS2RWUXdyRkRWV29BUDRKK0F5MlpKNEhiblJRcFpDZE40QjM1UVZBcDFrZnJmQmQ0QnQrSUU4QXl3VmVBVW9Vam5abSttR3VzOTRQMkM2Q1l3UStCSm84RUpkaFZ0RUVyQUJ1QmZZbElTL1FYYTRYVmdVcFdsVUJaaWlzQnY0VmMxSkxCQllMYkZINGtzSlR3RTBLaFhwWXFwdnltS1Y5QVhoV3plUXZGTmdpc0FoWTRzZHdEYkFLbU5HbVNwWGRsNVBrWkFHVlFZb2tTQWJPQm00QkptSWdYT3VnUGpMbmR4VXdYOUVDUWFyRmxrWERRTXh5eDZUWnZCTzFJVERVVzlyM0ZFcjlnRFBBR21DcGcrY2pLQU4rQkh3SkM2R1hGeUJQWlZITjVkMzlXa0Jsa01LQnl4amk5MkF4L04vRXpMOHBnaHVCUjRBekZBbzhwc1BVbGtiZXNqWklzVHRxQXloVHVCUDRnVUtwK05teWQzQUc4TEIvZDVQQUpjQy8rN0hkbTBFdlRJQ3J6TUVTK2dRZ252a1FGZ1BML2MvZlRNRE5ha25OdzhBVm5XWW5saUdZTDhoTEtvTVU2OE1NQXJPQmg0QkZDc25PWmhwLzkrKzhBbmhZWVdvQ2JnWXU5WDllbm9WRkNaRCtRT2dWZ01vZ1JWYVZESHdPK0JtV3JWMHlDRmFIY0pZZjRLbUE5TENPaW9GaCtTb1BGSnlVS0Zqa256MjdHNmhkUkRvK1RnVitIY0paUmNncXpESXp3QzFaT0MrTDBoY0l5WjUrckFwU1JFQkNwQUpiOHduZ1c4TndqelVTZlFHNFZXRmNIdzRrVG1wNmxiVkJDa0ZFVVZGd0NxVUszd08rbzFEUzIzMDl2VlBoV0lIL2FrTXZLMVo1dEVXMEVGcyt0eVNRUFFycnFvSVVQVVdrSGdHSTdHTUNzQlRMeks0Y292SklvMFRuQXNzVnh2YmpQUXVCRWZRamlwWUFvekZMUE02UDV3RXhBSWI3WjR6MG42V1laWWxYdWgwUTd4dkdDU3h2RVUwUFJoNXVSc2Y0OFM4RkxvaGdWMDlqK0FnQTNsd0tGYTdHNHUwZERuNXhTTFFDV05hZjh2NXZ6Zys4RCtVQks0aGFSaGFHZXc2a2t6dS9XUGZPTTZ2THhsRWtJbGxMandzeFh6SWNjM0FCVm1lY0lQWTV3UU1qSG9TeEFzdWEwZmNGN3ZKWjVEZUJxd1d1cUF4UzZlNlJvWXN1bGQ3MEJUNFAvQW9yUkQ2UGVkNUhnRlA2bTlWT2NvMnEzaENHSWFmdjJ2b1JrQlVLQmY0UlM1dmZ6Q1ZrYlE3S09hZ1JCU0pKaFJFS244UnlnSVhkTG4zVXdVVVJIQVU4aWhWa0Y2bnFieElpWFpaQ0Z3dFFVMzQ4RnRNendQVU8zbzhzMDhwSGVZQ2pGQ2hNZEx4aVhkbE1NaEtCemVoVkNoZUkxUkU1eWN5T2ZELzdjbGxxSCtnK0Vka0dMTlNPMmF3R2Z0NmsybFlzN0FhNUhvdFdWNG5JMnNpS3NYWnBqd0tWUVlyUU1yM0Z3RW5BQTJWYThFeGt5YytGQThqcVJoM3RDaVFlVlZXUUlrMEljS3pDU215SkRWYklEaVJqakE0V3RJTkJoL0xQQW90VjlaVWhJZ2lDZytlQUI0R1RnY1dSZG8wSzdkT2pRRUlrQUM3R0hNYWRkWkpSdjlZRzUxTTArTmtZdVZlelNTQlRHYVFvUktSVm1JL0Y2NW4rbWd5ZUUvQ0RTbUJyK2lDUTZXdFpoQWRMY01QU29LalhmalZtdWJ1VFltWHl6bUE2dTNCWnpJTFBBUzUySW84cTFIZXhnS29naGRyc0w4UWN4NnA1UjAxK0RmdHRvQ245aUU3MVFHRXJ1Z1RMMTJkMnVxWU5hQk1nUWxINHJNSUxDcGNtKzBsaUVpVnZ0Q01OM0NtV0JPMU9STnJPRVV5cTI0SW9UQ0Q1cWdmb2VHQ2hkcW9Ya3JHR1RtU1V3dm5BZThCRGxlKy9FU3MrVUFCS2dVSGVrMThOWEtwUTBzMlNtZ1ZhYlNaa2tNTFhGWjB1U0hIR25OZHVNTkpGVFZVSFJBSWFoWkV0S0FQeFZ3b044M3V3bUhuMU5hd0pVdW9CV0FLYzcwVHVWOWdQNERaUExFZE55MWxBQ25qV3dhdENPN29EQldDSUdxTnpOM0JsRDhxRGxiZXQvbnNKeGgrQ2VlK1JZTmFaVVNXRUJTSGNIOEtzREFyT29mYkFZb2l4NkZrOGNxOWlQaUtsTUV1QmRXWGx1QlpWVG5DRmdwRU1EbmdzZ214U3ZYMnAyZVlBWkJ4d0wrYWhYUzgrNUFPeEdRUWpWR0lQdlI5b2lORjNJc094WW1jUjhIMkhGS2xBa1lYL0Vyd2o3RTJjQ3BGZDh6aG05Wi81VWVzK3NxTG1BLzRRcFVjRDg0R2R3QWFBV2ZXMThmMmFMMi9razVKaXRVU2x4OXY5YisrMmFwUVZJRkp0QWU0UlpEdHdid0oyKytlZ01BYVk1R2ZpK0xqNHlwb3lKWFNBMktQTXFXOFBuK3U5anZPdkhUUjZ0SUZqTDVpQ3BhSWJFL0J1eDRBVlpHRHpINmVvL2NqYkJRaWk0RVFRK0IrQjB3U1dSUkIxaWdLdG1JVUFIQkpqak1GbzlSS2dKWmZ4Skl3ODJRajhsY0lVQlpJV1JXUTZWc0NzejZKaGdWcjRmcmtkaFc1ZnVzNWkzdUlYVndUVWlYUmhkck4wUzFROGtPOUU4SVFnWHdVZWE5YW9ZYkE0Zk5FMENIT21mWXBUeUlxR2dxekh5SlBwaWxhNWxhMk5ZRTJMTkxCTkVDcnFhL3pMQll5VHZ3YTRYZUMzQXJVQ2V6cXQzZGhNODVVbWpNSHBVd3JWeGV2M1d1QU1nZHVLVFhtd0lpa2hIZGJScTh5cHI0bjEyWWJsSHRQMlJsbVNsd3dxTFZFNEZ2Z0FlTHZ6VFQ2c2JGMGZsRzhkaEpORGhFazE3ejRHbzhXbUF1VmkzcjRNeSt6YVo2NGZlUThmNXZxU1UrbzN4MS8zQSt2aS82eXhPRDRlU0V0SEpNbEYzdmE2SGpmZUZReE9Zc1RGZUdDdndJR2U3dkNjdTNya0RnQUg5aytadi8zVnRrTlBDeVFpSzJtUEIyYUxVZVhUc2VyTmRjclJ1OHRPc1diSDRVZ0FOS1JWTTRYU1ArVCtpdjFxTGJqeFFHblNlOVJTNEU4Q3pibWE4c2p0YStLdkliQm5RMUMrcDBtamx3cEVscWxaeDZuQU9XTDV4Y2p1OVR1d0xhdmFVcEREd0x0TFZabXhWVTVrTXJBN0FZam1ObktCRmpYZ3B5b01TMkw4WFRId29ZTnNOTUNwT0tXalVtdmRFSlMvM3FyUjZ6N2oraHZnUElIek1NK2JFTE9tMm9RSWJnQXZWSUVrVWhCWjVQcnZibzYwTCtYaitxUEI2endraVhuUkpOQXl5aVdpZlZIWTc0UHlBS09sS2todGNzam1MTG9DT0Z2Z0lxemFYQXdjQ0IwdnJ3bFNoL0p0YjBYV2V4eVB4ZldjUklDUnBtT0wxM21Ra3c2cmpDYUh4RVhSRVpPNWRUVlUxRlZyRXRrZG9Tc0YvZ0hMeVFjRHF4VitBNXliUVFldkNWSnNtRGl6MzJmNkVjWVUycTVjRjVGREtFc1dlZndBUlp5YVNZUkE0VVlKUlFhd0puT1JpcnBxVHF1ckpZRWNVTldIUEJEZndmTCtoeFIrRFp5ZTFxaXdyeXF3S2tqRnVYazVzTmVaUjg5SlFwVGZwWnNGSzlBaWhJekRZbWdhR0pxeGV2eGpsWXE2YWs2dHIwV2dRVlh2eDJxUWE3RkM3REdGMnhST1dCK1VTMDh0TGdXU1NBS2p6WDhmcXFiem1iTFFkQnlLNVRITkRtakUrdmlqRklxTzdBTG9YZWJXMWNSQTdFM0NUVml2NFhIZ0s4QlRhZlJiRVpTdUNXYXdZV0o1RndCQ1cvdFRnWTNTamVQclMzekNWa1RIM29WRzV6dXUrNEF4YXNqOFdXVmVYUTFEblNpd1RlQnJHQ1BWQ2l3RFZvR2NGS2xLWlpCaVhkQU9SQW96NDIzNXZrOHQ3eGtEN0JQNDBEbWpuK3I5aitQL1hCYlFXYWJ0ckdaK1hRMENMVm5WVmNDNW1FODRFL2pmakZIYkpSbVVabzBBL2g3WTRmSndnRjU1TU9zWkE5UTdPT1F5cWxuZ05XejJKd1BvNURsL0FSaHNXWXlnQU9BTnNSMG4zOGRtZXBuQ0hVQlppYmd4V09uK1VvaW1jKzN2VjA5b2p5NlRzZHpudGF4cTFqbnorbHM4UURORFZkYW0rNjB1UHphWlViOHhya0dhRXRhUVhZVHRHdnNLRmpZdnc0cWdseVNQUFVJdExvcFo3NWxlMXkwaTBzNEsveDRyUXl1U0lzUFVIT05oeXl2SG5RanQvQWhVN1BoZHp2Zk9xNnVoS2toRmlqNG55UGxZajNJQjFxM2FJTEFqbjdINDdMSFU3eTU1MSt0c1ZKV3pDcWthbUthV0l4OFJDYk1Kd214aWRKaE5qQXF6Q1dxRGsvTzZmMjVkRFVXZXRNS1NwL3V3SkdhcTJoSXBYcFBqYmhBZkFhWmlxZmxtWjdVUHpnR2hhaHZ3TkxZMkZuUnZIZ3hVNHBjcUxGVVlmNUFzcitUNTNGbDExWHpDS1ZpMWVqbG1DVVhBZFFyWEN3enJENFNxSUVWazVyL0E2L2gwaUxZNXdNMnBxOEZuZjg5ajlmbTVUbVRNRVl3R2pWZ2hkQ2N3SVF1c3p4T0U0M2JXeG42aFVlQUh3QTJZSlh4WDRTYUJFV3VDRkZ0NlNhTWp3SW1NeGFMTEx1Q0YySDg0YU9mTGRtQWJuRTRFRmlqNWJUYnFCNEFXLy9LVndNUTBWdExtSzU0amJISHdVK0FuR0ZQME5ZV2JCVVkyYWtUTHhIbGQ3bGxiMXA0Nkw4Q1lyeWNUc0NNT253NmdLRkpDcXdjZXhES2tpeDB5WXFDbGNTeSt5bW9DRG5tTFdvRHRNNW9TUWQ3TElRWkJvVldzNzMrVEIyR0p3bzBDd3pkcFU1ZnJRd0dIak1RU3JJUEFxaENpbUxweUFDZS9YUnNQZGdQd1cyQ3V3c0lqWkFVdGRJMHFud0x1UlppV2dRRTl2eE1JUDhYeUF3WCtXZUU2Z1pMWWY4VXRQN1dXM3h5TTA5d2dRTG5uUGR2emlLUUthZ1hDQ296MnVreVE0SEN0QUV0ckc3cjlWZ0hjSjFBZURoRGsrUVpDczFnaHRjcnJjb2xhZzdTd2ZhK0R5RVFzZDlnUHJGQklkeTU0MmdHWVhWK05LQ1NzZVhBM01BMjQzRUhCUUNPQ0Q3RVo0RUFQS1d1NWdTQ3pzM2x1Ym94bHNEclV3TDBhYytJRldCdnU0clFxWXYrL0hBdDlkeWY4N0o5YzM1RThkY2trNTlYWEVKclR2QjNZQlB4TEJBdkRnWVpGaFZiVmtONXI5bW5BZlU3a3RNd0Ezakd6Zm5OY3Y3K0RiYkI2RFNOYXlocklvcllENVdLc0dYSkgyTFhaOGxFQXdHaGNSWGRoNGFZVitFOG5VcTdrNzdrVmpWUE5EM3EvaGluQVBRbVJCWTBhNVcwSmNTaFRkQ3ZXdjdoYllPbG9LU2dIZnV4MStJSENMdGREYlA4SUFIUHJhM0FJQ2V1azNvRHgvVDhISmtZQzYvSUFZVjU5YlV3Qjl3cUF6NU1uQVN1SGlqdTNJSWZOalI4WmM1Mk5XZUJKZ1c5N3B2dFdQL2FmSk9FNTUzWHJGd0F3THh0YUgzNEY4QXRnTG5BYmNFeEdMTGJtS3I0Yjh3SDAzajN5SUV3QTdtcURMN29jdDdsMkZ1L3RzMm9VMjIyWTE3OUw0TTZlVEw5UEFLQ0xsLzBoNW1YUHhySzVJSlM4WS9oK09vN0g5QVhDT09EMkVMNHNrTWdWaExWQkt0NnZHZ0IzWVRUYmd3SS9WR2p1YTZ0Tm4rVjBvUkg0SDRqdHlWM3RRZmdsY0dJNlA4OTlnSTZPYm44Z0hJVjFoNzhxa093UGhIZ0RCZGFOaWpuR1ZkZ084LzBGL2JEY2ZRSXc2NjBhaW0xUTc0a3h1Q3N4MDNyWWlaeW5PUXpReTRmazBNTHVCTUp3NEtZSXZvMlA2VDJKMzIrWWRDS2Z3N2JDVldCTDlqTGd2UUtVMlIzN0hIcDlYMDZ5eGs1dURGRUQ0aXAvN3dxQjVaSHlia0xva1p6MGxWb0F2S3p3eVZ4ZjZIdUt6Y0NQeGZqQjF0aVVxNElVb2JYMXgzdGx2K0Z2dVZGc0syL1QvQnlKa3J5YUFKM09DcDBOWEkvRjhVM0FVb0duRkpxS2tNNmRvVGkyajFaNFVlR3Y4d0hBRDdBTnVNN1pLWlNzQjZaRWJReFhZbDJtcmNCL2lCVnplWjBkeXJzTFVoVzBOeVluWWI3aHl4aHY5eHl3VXVEbEVHMHNRcGhkVnhNRE1FVGhHY3hFTzBXRHJzMzBUb05SYk5uOEVhZ0NIbmV3UnEzOWZocEdobndhaS9FUEFEK0xWTjlLNWtHUkR4aUFXRHB0cXA2UG1lR24vWi9XWTF2Y25oZDRTeUh0cklWK0ZuWnRHY2JLRHZYQWdUbkkrT1JvSFpiUmJSUDRZd0thczdhRXpzVE9EczN5QUQwUDNDcTJrU1V6a0tNNWh3VUEyQkhaVnR0RFZhSlc1UzNCanJPVVloempCdXg4VDdYQW13SUhmQWM2b2RiWGl6dFJvVURHUVJoQmdkOElQUWt6NzFPeGZjcmpzTHovQmVDWFlrdXFxUkNZZFJnbjA0NUlJN0IyMGtrY2pFTEVOa1pPdzQ2em5Za1ZJU1hZRE84Qi9vUXhNbnU5TXZIT2p2aUF4VmpnR0d3WCtGak1RcG93QXZOcExOUGJxdEEyakFUVDZ6WWQ5dGlQZUNkMHJUOW5sTGFEVThkak5IUTU5djFvcjJneE52dWRqZ0FSWXFHeUFhUG0vb0FSdFpzRXRoY2dqU0dxaDN0VTltTUhvTHQwT2dZNzFDYzVZN0RlWENsZFQ0OS9pS1hNN3dtODcrQ2c1bkhjZHFEeS93SXZxRWdidnNUUEFBQUFBRWxGVGtTdVFtQ0MiLz48L3N2Zz4K',
  projects: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCIgdmlld0JveD0iMCAwIDY0IDY0Ij48cmVjdCB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHJ4PSIxNCIgZmlsbD0iI0Q5QTQ0MSIvPjxyZWN0IHg9IjE3IiB5PSIxNCIgd2lkdGg9IjMwIiBoZWlnaHQ9IjM5IiByeD0iNCIgZmlsbD0iI0ZGRjhFNiIgc3Ryb2tlPSIjMUMyMjMwIiBzdHJva2Utd2lkdGg9IjMiLz48cmVjdCB4PSIyNCIgeT0iMTAiIHdpZHRoPSIxNiIgaGVpZ2h0PSI4IiByeD0iMyIgZmlsbD0iIzFDMjIzMCIvPjxnIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzFDMjIzMCIgc3Ryb2tlLXdpZHRoPSIzIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik0yMi41IDI4bDMgMyA1LTZNMzQuNSAyOC41aDdNMjIuNSA0MWwzIDMgNS02TTM0LjUgNDEuNWg3Ii8+PC9nPjwvc3ZnPgo=',
  snakie: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAyNCIgaGVpZ2h0PSIxMDI0IiB2aWV3Qm94PSIwIDAgMTAyNCAxMDI0IiBmaWxsPSJub25lIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPgogIDxkZWZzPgogICAgPGxpbmVhckdyYWRpZW50IGlkPSJiZyIgeDE9IjAiIHkxPSIwIiB4Mj0iMTAyNCIgeTI9IjEwMjQiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwIiBzdG9wLWNvbG9yPSIjMzRkMzk5Ii8+CiAgICAgIDxzdG9wIG9mZnNldD0iMC41NSIgc3RvcC1jb2xvcj0iIzEwYjk4MSIvPgogICAgICA8c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMwZDk0ODgiLz4KICAgIDwvbGluZWFyR3JhZGllbnQ+CiAgICA8bGluZWFyR3JhZGllbnQgaWQ9ImJvZHkiIHgxPSIzMjAiIHkxPSIyNDAiIHgyPSI3MDAiIHkyPSI3ODAiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj4KICAgICAgPHN0b3Agb2Zmc2V0PSIwIiBzdG9wLWNvbG9yPSIjZmZmZmZmIi8+CiAgICAgIDxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iI2ZkZTY4YSIvPgogICAgPC9saW5lYXJHcmFkaWVudD4KICA8L2RlZnM+CgogIDwhLS0gQXBwLWljb24gc3F1aXJjbGUgYmFja2dyb3VuZCAtLT4KICA8cmVjdCB4PSIwIiB5PSIwIiB3aWR0aD0iMTAyNCIgaGVpZ2h0PSIxMDI0IiByeD0iMjMyIiBmaWxsPSJ1cmwoI2JnKSIvPgoKICA8IS0tIHNvZnQgaW5uZXIgaGlnaGxpZ2h0IC0tPgogIDxyZWN0IHg9IjAiIHk9IjAiIHdpZHRoPSIxMDI0IiBoZWlnaHQ9IjEwMjQiIHJ4PSIyMzIiIGZpbGw9IiNmZmZmZmYiIG9wYWNpdHk9IjAuMDYiLz4KCiAgPCEtLSBzbmFrZSBzaGFkb3cgLS0+CiAgPHBhdGggZD0iTSA2NjggMzcyIEMgNjY4IDI4NiA0MDggMjY4IDM4MCAzOTIgQyAzNTIgNTE2IDcwMCA1MzIgNjY4IDY1NCBDIDY0MCA3NjIgNDE0IDc3OCAzNjAgNjk0IgogICAgICAgIHN0cm9rZT0iIzA2NGUzYiIgc3Ryb2tlLW9wYWNpdHk9IjAuMjUiIHN0cm9rZS13aWR0aD0iMTM4IiBmaWxsPSJub25lIgogICAgICAgIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoMCwxNikiLz4KCiAgPCEtLSBzbmFrZSBib2R5IChTKSAtLT4KICA8cGF0aCBkPSJNIDY2OCAzNzIgQyA2NjggMjg2IDQwOCAyNjggMzgwIDM5MiBDIDM1MiA1MTYgNzAwIDUzMiA2NjggNjU0IEMgNjQwIDc2MiA0MTQgNzc4IDM2MCA2OTQiCiAgICAgICAgc3Ryb2tlPSJ1cmwoI2JvZHkpIiBzdHJva2Utd2lkdGg9IjEzMCIgZmlsbD0ibm9uZSIKICAgICAgICBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiLz4KCiAgPCEtLSBoZWFkIC0tPgogIDxjaXJjbGUgY3g9IjY2OCIgY3k9IjM3MiIgcj0iODYiIGZpbGw9InVybCgjYm9keSkiLz4KICA8IS0tIGV5ZSAtLT4KICA8Y2lyY2xlIGN4PSI3MDAiIGN5PSIzNDgiIHI9IjE3IiBmaWxsPSIjMGYzZDJlIi8+CiAgPCEtLSB0b25ndWUgLS0+CiAgPHBhdGggZD0iTSA3MjQgNDA4IEwgNzYyIDQ1MiBNIDc2MiA0NTIgTCA3OTIgNDQwIE0gNzYyIDQ1MiBMIDc4OCA0NzAiCiAgICAgICAgc3Ryb2tlPSIjZWY0NDQ0IiBzdHJva2Utd2lkdGg9IjEzIiBmaWxsPSJub25lIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiLz4KPC9zdmc+Cg==',
  bettercad: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCIgdmlld0JveD0iMCAwIDY0IDY0Ij48cmVjdCB3aWR0aD0iNjQiIGhlaWdodD0iNjQiIHJ4PSIxNCIgZmlsbD0iI0YzRUVGRiIvPjxwYXRoIHRyYW5zZm9ybT0idHJhbnNsYXRlKDggMTApIHNjYWxlKDIpIiBkPSJtMTIgMiA4IDQuNXY5TDEyIDIwbC04LTQuNXYtOXpNMTIgMTFsOC00LjVNMTIgMTEgNCA2LjVNMTIgMTF2OSIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjN0MzQUVEIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPjwvc3ZnPgo='
})

/** The apps in the suite, in switcher order. */
export const KR_APPS = Object.freeze([
  {
    id: 'learn',
    name: 'Learn',
    blurb: 'Courses, lessons and part guides',
    url: 'https://www.kevsrobots.com/learn/',
    mark: 'KR',
    icon: KR_ICONS.learn
  },
  {
    id: 'projects',
    name: 'Projects',
    blurb: 'Your builds, steps and parts lists',
    url: 'https://www.kevsrobots.com/projects/hub',
    mark: 'P',
    icon: KR_ICONS.projects
  },
  {
    id: 'snakie',
    name: 'Snakie',
    blurb: 'Write and run MicroPython',
    url: 'https://app.snakie.org/',
    mark: 'S',
    icon: KR_ICONS.snakie
  },
  {
    id: 'bettercad',
    name: 'BetterCAD',
    blurb: 'Design parts to 3D print',
    url: 'https://bettercad.kevsrobots.com/',
    mark: 'B',
    icon: KR_ICONS.bettercad
  }
])

/** Up to two letters for an avatar: "Kevin McAleer" → "KM", "kev" → "KE". */
export function initials(user) {
  if (!user) return ''
  const name = String(user.name || '').trim()
  if (name) {
    const words = name.split(/\s+/).filter(Boolean)
    const letters = words.length > 1 ? words[0][0] + words[words.length - 1][0] : words[0].slice(0, 2)
    return letters.toUpperCase()
  }
  return String(user.username || '').trim().slice(0, 2).toUpperCase()
}

/** The name to show for a user: their name, else their username. */
export function displayName(user) {
  if (!user) return ''
  return String(user.name || '').trim() || String(user.username || '').trim()
}

/** Where to put a card under a button so it stays on screen. */
export function placeCard(button, card, viewport) {
  const gap = 6
  const margin = 8
  const width = Math.min(card.width, viewport.width - margin * 2)
  let left = button.left
  if (left + width > viewport.width - margin) left = Math.max(margin, button.right - width)
  let top = button.bottom + gap
  if (top + card.height > viewport.height - margin && button.top - gap - card.height >= margin) {
    top = button.top - gap - card.height
  }
  return { left: Math.round(left), top: Math.round(top), width: Math.round(width) }
}

// ---------------------------------------------------------------------------
// The elements. Everything below needs a DOM; the helpers above don't, so the
// file can be imported in Node for tests.
// ---------------------------------------------------------------------------

const PALETTE = `
  --_ink: var(--kr-ink, #1C2230);
  --_soft: var(--kr-ink-soft, #5A6275);
  --_line: var(--kr-line, #E2E4E8);
  --_panel: var(--kr-panel, #FFFFFF);
  --_sunk: var(--kr-sunk, #EEF0EC);
  --_shadow: var(--kr-shadow, 0 1px 2px rgba(28,34,48,.06), 0 8px 24px rgba(28,34,48,.12));
  --_focus: var(--kr-focus, #2F6FEB);
`
const PALETTE_DARK = `
  --_ink: var(--kr-ink, #E8EAEE);
  --_soft: var(--kr-ink-soft, #A2A9B8);
  --_line: var(--kr-line, #2E323B);
  --_panel: var(--kr-panel, #1C1F26);
  --_sunk: var(--kr-sunk, #181B21);
  --_shadow: var(--kr-shadow, 0 1px 2px rgba(0,0,0,.3), 0 8px 24px rgba(0,0,0,.4));
  --_focus: var(--kr-focus, #7AA7FF);
`

/** Accents chosen to hold 4.5:1 against white text. */
const ACCENTS = {
  learn: '#C22032',
  projects: '#C22032',
  snakie: '#1E7F52',
  bettercad: '#7C3AED'
}

const BASE_CSS = `
  :host {
    ${PALETTE}
    --_acc: var(--kr-accent, ${ACCENTS.learn});
    --_on-acc: var(--kr-on-accent, #FFFFFF);
    position: relative;
    display: inline-flex;
    align-items: center;
    font-family: var(--kr-font-ui, inherit);
    color: var(--_ink);
  }
  :host([app="snakie"]) { --_acc: var(--kr-accent, ${ACCENTS.snakie}); }
  :host([app="bettercad"]) { --_acc: var(--kr-accent, ${ACCENTS.bettercad}); }
  :host([theme="dark"]) { ${PALETTE_DARK} }
  @media (prefers-color-scheme: dark) {
    :host(:not([theme="light"])) { ${PALETTE_DARK} }
  }
  :host([hidden]) { display: none; }
  * { box-sizing: border-box; }
  .trigger {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 1px solid var(--_line);
    border-radius: 8px;
    background: transparent;
    color: var(--_soft);
    cursor: pointer;
    font: inherit;
  }
  .trigger:hover, .trigger[aria-expanded="true"] { border-color: var(--_acc); color: var(--_ink); }
  .trigger:focus-visible, a:focus-visible, button:focus-visible {
    outline: 2px solid var(--_focus);
    outline-offset: 2px;
  }
  .card {
    position: fixed;
    z-index: var(--kr-z, 2000);
    width: 320px;
    max-height: calc(100vh - 16px);
    overflow: auto;
    padding: 8px;
    border: 1px solid var(--_line);
    border-radius: 12px;
    background: var(--_panel);
    color: var(--_ink);
    box-shadow: var(--_shadow);
    font-size: 14px;
    line-height: 1.4;
    text-align: left;
  }
  .card[hidden] { display: none; }
  .eyebrow {
    margin: 4px 8px 6px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: .08em;
    text-transform: uppercase;
    color: var(--_soft);
  }
  @media (prefers-reduced-motion: no-preference) {
    .card:not([hidden]) { animation: kr-in .12s ease-out; }
    @keyframes kr-in { from { opacity: 0; transform: translateY(-4px); } }
  }
`

const GRID_ICON =
  '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">' +
  [2, 7, 12]
    .flatMap((y) => [2, 7, 12].map((x) => `<rect x="${x - 0.5}" y="${y - 0.5}" width="3" height="3" rx="0.8" fill="currentColor"/>`))
    .join('') +
  '</svg>'

const PERSON_ICON =
  '<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">' +
  '<circle cx="12" cy="8.5" r="3.6"/><path d="M4.8 19.5c1.3-3.3 4-5 7.2-5s5.9 1.7 7.2 5"/></svg>'

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const HTMLElementBase = typeof HTMLElement === 'undefined' ? class {} : HTMLElement

/** A button that opens a card, with the suite's open/close rules. */
class KrPopup extends HTMLElementBase {
  constructor() {
    super()
    this.attachShadow({ mode: 'open' })
    this._onDocPointer = (e) => {
      if (!e.composedPath().includes(this)) this.close()
    }
    this._onResize = () => this.close()
  }

  get open() {
    return !!this._card && !this._card.hidden
  }

  disconnectedCallback() {
    this._unlisten()
  }

  /** Subclasses render, then call this with the trigger and the card. */
  _wire(trigger, card) {
    this._trigger = trigger
    this._card = card
    trigger.addEventListener('click', () => (this.open ? this.close() : this.show()))
    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' && !this.open) {
        e.preventDefault()
        this.show()
      }
    })
    card.addEventListener('keydown', (e) => this._cardKey(e))
    this.shadowRoot.addEventListener('focusout', (e) => {
      // Tabbing out of the card closes it. (A click elsewhere is the
      // pointerdown listener's job; relatedTarget is null then.)
      const to = e.relatedTarget
      if (this.open && to && !this.shadowRoot.contains(to) && !this.contains(to)) this.close()
    })
  }

  _items() {
    return [...this._card.querySelectorAll('a[href], button:not([disabled])')]
  }

  _cardKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      this.close(true)
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
    const items = this._items()
    if (!items.length) return
    e.preventDefault()
    const at = items.indexOf(this.shadowRoot.activeElement)
    let next = 0
    if (e.key === 'End') next = items.length - 1
    else if (e.key === 'ArrowDown') next = at < 0 ? 0 : (at + 1) % items.length
    else if (e.key === 'ArrowUp') next = at <= 0 ? items.length - 1 : at - 1
    items[next].focus()
  }

  show() {
    if (this.open) return
    this._card.hidden = false
    this._trigger.setAttribute('aria-expanded', 'true')
    this._place()
    document.addEventListener('pointerdown', this._onDocPointer, true)
    window.addEventListener('resize', this._onResize)
    const first = this._items()[0]
    if (first) first.focus()
  }

  close(returnFocus = false) {
    if (!this._card || this._card.hidden) return
    this._card.hidden = true
    this._trigger.setAttribute('aria-expanded', 'false')
    this._unlisten()
    if (returnFocus) this._trigger.focus()
  }

  _unlisten() {
    if (typeof document === 'undefined') return
    document.removeEventListener('pointerdown', this._onDocPointer, true)
    window.removeEventListener('resize', this._onResize)
  }

  _place() {
    const b = this._trigger.getBoundingClientRect()
    const c = this._card.getBoundingClientRect()
    const at = placeCard(
      b,
      { width: c.width || 320, height: c.height || 0 },
      { width: window.innerWidth, height: window.innerHeight }
    )
    this._card.style.left = `${at.left}px`
    this._card.style.top = `${at.top}px`
    this._card.style.width = `${at.width}px`
  }
}

let nextId = 0

export class KrAppSwitcher extends KrPopup {
  static get observedAttributes() {
    return ['app', 'target']
  }

  connectedCallback() {
    if (!this._trigger) this._render()
  }

  attributeChangedCallback() {
    if (this._trigger) this._renderList()
  }

  _render() {
    const id = `kr-apps-${++nextId}`
    this.shadowRoot.innerHTML = `
      <style>
        ${BASE_CSS}
        ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
        a {
          display: grid;
          grid-template-columns: 36px 1fr;
          gap: 12px;
          align-items: center;
          padding: 8px;
          border-radius: 8px;
          color: inherit;
          text-decoration: none;
        }
        a:hover, a:focus-visible { background: var(--_sunk); }
        a[aria-current] { background: var(--_sunk); }
        .ic {
          display: block;
          width: 36px;
          height: 36px;
          border-radius: 9px;
        }
        b { display: block; font-size: 14px; font-weight: 700; }
        .blurb { display: block; font-size: 12.5px; color: var(--_soft); }
        .here { font-weight: 500; color: var(--_soft); font-size: 12px; }
      </style>
      <button class="trigger" type="button" part="button" aria-haspopup="true" aria-expanded="false"
        aria-controls="${id}" aria-label="Switch kevsrobots app" title="kevsrobots apps">${GRID_ICON}</button>
      <nav class="card" id="${id}" part="card" aria-label="kevsrobots apps" hidden>
        <div class="eyebrow" aria-hidden="true">kevsrobots apps</div>
        <ul></ul>
      </nav>`
    this._wire(this.shadowRoot.querySelector('.trigger'), this.shadowRoot.querySelector('.card'))
    this._renderList()
  }

  _renderList() {
    const here = this.getAttribute('app')
    const target = this.getAttribute('target')
    const list = this.shadowRoot.querySelector('ul')
    list.innerHTML = KR_APPS.map((a) => {
      const current = a.id === here
      const t = target && !current ? ` target="${esc(target)}" rel="noopener"` : ''
      return `<li><a href="${esc(a.url)}"${t}${current ? ' aria-current="page"' : ''} data-app="${a.id}">
        <img class="ic" src="${a.icon}" alt="" width="36" height="36" draggable="false">
        <span><b>${esc(a.name)}${current ? ' <span class="here">· you are here</span>' : ''}</b>
        <span class="blurb">${esc(a.blurb)}</span></span></a></li>`
    }).join('')
    for (const link of list.querySelectorAll('a[aria-current]')) {
      // You are already here: just close.
      link.addEventListener('click', (e) => {
        e.preventDefault()
        this.close(true)
      })
    }
    for (const link of list.querySelectorAll('a:not([aria-current])')) {
      link.addEventListener('click', () => this.close())
    }
  }
}

export class KrAccount extends KrPopup {
  static get observedAttributes() {
    return ['busy', 'account-href']
  }

  constructor() {
    super()
    this._user = null
  }

  get user() {
    return this._user
  }

  set user(value) {
    this._user = value && (value.name || value.username) ? value : null
    this.toggleAttribute('signed-in', !!this._user)
    if (this._trigger) this._renderState()
  }

  connectedCallback() {
    if (!this._trigger) this._render()
  }

  attributeChangedCallback() {
    if (this._trigger) this._renderState()
  }

  _render() {
    const id = `kr-account-${++nextId}`
    this.shadowRoot.innerHTML = `
      <style>
        ${BASE_CSS}
        .trigger { border-radius: 50%; overflow: hidden; }
        .trigger.in { border-color: transparent; background: var(--kr-gold, #D9A441); color: #1C2230; font-weight: 700; font-size: 12px; }
        .trigger img { width: 100%; height: 100%; object-fit: cover; display: block; }
        .card { width: 280px; }
        .who { padding: 8px; display: grid; gap: 2px; }
        .who b { font-size: 14px; }
        .who span, .note { color: var(--_soft); font-size: 13px; }
        .note { margin: 4px 8px 10px; }
        hr { border: 0; border-top: 1px solid var(--_line); margin: 6px 0; }
        .item {
          display: block;
          width: 100%;
          padding: 8px;
          border: 0;
          border-radius: 8px;
          background: transparent;
          color: inherit;
          font: inherit;
          text-align: left;
          text-decoration: none;
          cursor: pointer;
        }
        .item:hover, .item:focus-visible { background: var(--_sunk); }
        .primary {
          display: block;
          width: calc(100% - 16px);
          margin: 0 8px 8px;
          padding: 8px 12px;
          border: 0;
          border-radius: 8px;
          background: var(--_acc);
          color: var(--_on-acc);
          font: inherit;
          font-weight: 600;
          cursor: pointer;
        }
        button[disabled] { opacity: .6; cursor: default; }
        ::slotted([slot="items"]) { display: block; }
      </style>
      <button class="trigger" type="button" part="button" aria-haspopup="true" aria-expanded="false" aria-controls="${id}"></button>
      <div class="card" id="${id}" part="card" role="group" hidden></div>`
    this._wire(this.shadowRoot.querySelector('.trigger'), this.shadowRoot.querySelector('.card'))
    this._renderState()
  }

  _renderState() {
    const trigger = this._trigger
    const card = this._card
    const user = this._user
    const busy = this.hasAttribute('busy')
    const href = this.getAttribute('account-href') || KR_ACCOUNT_URL
    trigger.classList.toggle('in', !!user)
    if (user) {
      const name = displayName(user)
      trigger.setAttribute('aria-label', `Your kevsrobots account: ${name}`)
      trigger.title = `Signed in as ${name}`
      trigger.innerHTML = user.avatarUrl
        ? `<img src="${esc(user.avatarUrl)}" alt="">`
        : `<span aria-hidden="true">${esc(initials(user))}</span>`
      const img = trigger.querySelector('img')
      if (img) img.addEventListener('error', () => (trigger.innerHTML = `<span aria-hidden="true">${esc(initials(user))}</span>`))
      card.setAttribute('aria-label', 'Your kevsrobots account')
      card.innerHTML = `
        <div class="who"><b>${esc(name)}</b>${user.username && user.username !== name ? `<span>@${esc(user.username)}</span>` : ''}</div>
        <hr>
        <a class="item" href="${esc(href)}" target="_blank" rel="noopener">Your kevsrobots account</a>
        <slot name="items"></slot>
        <hr>
        <button class="item" type="button" data-act="sign-out"${busy ? ' disabled' : ''}>Sign out</button>`
    } else {
      trigger.setAttribute('aria-label', 'kevsrobots account: not signed in')
      trigger.title = 'Not signed in'
      trigger.innerHTML = PERSON_ICON
      card.setAttribute('aria-label', 'kevsrobots account')
      card.innerHTML = `
        <div class="who"><b>Not signed in</b></div>
        <p class="note"><slot name="note">Sign in with your kevsrobots account.</slot></p>
        <button class="primary" type="button" data-act="sign-in"${busy ? ' disabled' : ''}>${busy ? 'Waiting for kevsrobots…' : 'Sign in with kevsrobots'}</button>`
    }
    const act = card.querySelector('[data-act]')
    act.addEventListener('click', () => {
      const name = act.dataset.act === 'sign-in' ? 'kr-sign-in' : 'kr-sign-out'
      this.close(true)
      this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true }))
    })
  }
}

if (typeof customElements !== 'undefined') {
  if (!customElements.get('kr-app-switcher')) customElements.define('kr-app-switcher', KrAppSwitcher)
  if (!customElements.get('kr-account')) customElements.define('kr-account', KrAccount)
}
