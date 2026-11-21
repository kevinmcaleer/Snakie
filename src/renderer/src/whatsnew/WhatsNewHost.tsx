import { lazy, Suspense } from 'react'
import { useWhatsNew } from './useWhatsNew'

// The notes and their UI load in their own chunk, after first paint.
const WhatsNewDialog = lazy(() => import('./WhatsNew').then((m) => ({ default: m.WhatsNewDialog })))
const WhatsNewCard = lazy(() => import('./WhatsNew').then((m) => ({ default: m.WhatsNewCard })))

/**
 * WHAT'S NEW (modelled on BetterCAD's).
 *
 * After an update, a small card in the corner names the new features once; See
 * what's new opens the full list. Help ▸ What's new (and the Help panel's
 * button) open the list again any time, through `openWhatsNew()` in ./useWhatsNew.
 */
export function WhatsNewHost(): JSX.Element | null {
  const whatsNew = useWhatsNew()
  if (!whatsNew.card && !whatsNew.open) return null
  return (
    <Suspense fallback={null}>
      {whatsNew.card && (
        <WhatsNewCard fresh={whatsNew.fresh} onOpen={whatsNew.show} onDismiss={whatsNew.dismiss} />
      )}
      {whatsNew.open && <WhatsNewDialog fresh={whatsNew.fresh} onClose={whatsNew.close} />}
    </Suspense>
  )
}
