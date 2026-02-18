package mono.headless

/**
 * Initialize Node.js compatibility shims for browser APIs used by
 * downstream Kotlin/JS modules (commons/WindowExt.kt, etc.).
 * Must be called before any shape/rendering operations.
 */
fun initNodeCompat() {
    js(
        """
        if (typeof globalThis.window === 'undefined') {
            globalThis.window = {
                setTimeout: function(fn, ms) { return setTimeout(fn, ms); },
                clearTimeout: function(id) { clearTimeout(id); },
                setInterval: function(fn, ms) { return setInterval(fn, ms); },
                clearInterval: function(id) { clearInterval(id); },
                requestAnimationFrame: function(fn) { return setTimeout(fn, 0); },
                cancelAnimationFrame: function(id) { clearTimeout(id); },
                navigator: { platform: 'Node' }
            };
        }
        if (typeof globalThis.navigator === 'undefined') {
            globalThis.navigator = { platform: 'Node' };
        }
        """
    )
}
