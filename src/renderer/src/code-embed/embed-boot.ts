/**
 * Runs FIRST in the embed (imported before anything else in `embed-main.tsx`):
 * read the URL, give the page its own private storage, set the skin. Module
 * imports evaluate in order, so every store that reads localStorage at load
 * time sees the memory one. See `memory-storage.ts` for why.
 */
import { parseEmbedParams } from './params'
import { installMemoryStorage } from './memory-storage'

export const EMBED_PARAMS = parseEmbedParams(window.location.search)

installMemoryStorage({
  'snakie.theme.v2': JSON.stringify(EMBED_PARAMS.theme),
  // `simple` is the beginner's drawers; `advanced` adds classes, try, etc.
  'snakie.blocks.level': JSON.stringify(EMBED_PARAMS.toolbox),
  // Tighter than the app's 30px ruled paper: an embed is a few lines in a page.
  'snakie.editor.lineSpacing': '24',
  'snakie.editor.minimap': 'false',
  'snakie.status.tips': 'false'
})

document.documentElement.setAttribute('data-theme', EMBED_PARAMS.theme)
document.documentElement.setAttribute('data-embed', 'code')
