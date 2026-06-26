package com.agenticandroid

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CodeHighlightTest {
    /** The token spans must tile the whole string exactly — no gaps, no overlaps, ordered. */
    private fun assertCovers(text: String, kind: PreviewKind) {
        val spans = Code.tokenize(text, kind)
        var pos = 0
        for (s in spans) {
            assertEquals("gap/overlap before $s in $kind", pos, s.start)
            assertTrue("empty/negative span $s", s.end > s.start)
            pos = s.end
        }
        assertEquals("spans must reach end ($kind)", text.length, pos)
    }

    private fun tokenAt(text: String, kind: PreviewKind, needle: String): Tok {
        val at = text.indexOf(needle)
        return Code.tokenize(text, kind).first { at >= it.start && at < it.end }.tok
    }

    @Test fun coverageJsonXmlCode() {
        val json = """{ "name": "Ada", "n": 42, "ok": true }"""
        val xml = """<note id="1"><!-- hi --><to>You</to></note>"""
        val code = "val x = \"hi\" // greet\nfun f() { return 1 }"
        assertCovers(json, PreviewKind.JSON)
        assertCovers(xml, PreviewKind.XML)
        assertCovers(code, PreviewKind.CODE)
        assertCovers("", PreviewKind.CODE) // empty is fine
    }

    @Test fun jsonKeysVsValues() {
        val json = """{ "name": "Ada", "n": 42, "ok": null }"""
        assertEquals(Tok.KEY, tokenAt(json, PreviewKind.JSON, "\"name\""))
        assertEquals(Tok.STRING, tokenAt(json, PreviewKind.JSON, "\"Ada\""))
        assertEquals(Tok.NUMBER, tokenAt(json, PreviewKind.JSON, "42"))
        assertEquals(Tok.LITERAL, tokenAt(json, PreviewKind.JSON, "null"))
    }

    @Test fun codeCommentStringKeyword() {
        val code = "val x = \"hi\" // note"
        assertEquals(Tok.KEYWORD, tokenAt(code, PreviewKind.CODE, "val"))
        assertEquals(Tok.STRING, tokenAt(code, PreviewKind.CODE, "\"hi\""))
        assertEquals(Tok.COMMENT, tokenAt(code, PreviewKind.CODE, "// note"))
    }

    @Test fun xmlTagAttrValue() {
        val xml = """<a href="x">t</a>"""
        assertEquals(Tok.TAG, tokenAt(xml, PreviewKind.XML, "a"))
        assertEquals(Tok.ATTR, tokenAt(xml, PreviewKind.XML, "href"))
        assertEquals(Tok.STRING, tokenAt(xml, PreviewKind.XML, "\"x\""))
    }

    @Test fun kindFromMimeAndName() {
        assertEquals(PreviewKind.IMAGE, previewKind("image/jpeg", "photo.jpg"))
        assertEquals(PreviewKind.IMAGE, previewKind(null, "photo.JPG"))
        assertEquals(PreviewKind.IMAGE, previewKind(null, "a.png"))
        assertEquals(PreviewKind.JSON, previewKind(null, "log_list.json"))
        assertEquals(PreviewKind.XML, previewKind(null, "layout.xml"))
        assertEquals(PreviewKind.MARKDOWN, previewKind(null, "README.md"))
        assertEquals(PreviewKind.CODE, previewKind(null, "Main.kt"))
        assertEquals(PreviewKind.TEXT, previewKind("text/plain", "notes.txt"))
    }
}
