package com.agenticandroid

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** Asserts the *plain text* the renderer produces (markers stripped); styling spans are visual. */
class MarkdownTest {
    @Test fun stripsInlineMarkers() {
        assertEquals("bold and code", Markdown.toAnnotated("**bold** and `code`").text)
    }

    @Test fun heading() {
        assertEquals("Title", Markdown.toAnnotated("## Title").text)
    }

    @Test fun bulletGetsDot() {
        assertEquals("•  item one", Markdown.toAnnotated("- item one").text)
    }

    @Test fun linkKeepsLabelDropsUrl() {
        val out = Markdown.toAnnotated("see [the docs](https://x.y) now").text
        assertTrue(out, out.contains("the docs"))
        assertTrue(out, !out.contains("https://x.y"))
    }

    @Test fun fencedCodeKeepsContentDropsFences() {
        val out = Markdown.toAnnotated("run:\n```\nval x = 1\n```\ndone").text
        assertTrue(out, out.contains("val x = 1"))
        assertTrue(out, !out.contains("```"))
        assertTrue(out, out.contains("done"))
    }

    @Test fun italicBothForms() {
        assertEquals("a b", Markdown.toAnnotated("*a* _b_").text)
    }
}
