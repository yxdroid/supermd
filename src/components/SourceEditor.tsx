import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { Compartment, EditorState, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, keymap, lineNumbers } from "@codemirror/view";
import { scrollRatio, scrollTopForRatio } from "../lib/scrollSync";

interface SourceEditorProps {
  content: string;
  initialScrollRatio?: number;
  onChange: (next: string) => void;
  focusTarget: { line: number; column: number } | null;
  onScrollRatio?: (ratio: number) => void;
}

export interface SourceEditorHandle {
  getScrollRatio: () => number;
  scrollToRatio: (ratio: number) => void;
}

function scrollViewToRatio(view: EditorView, ratio: number) {
  view.scrollDOM.scrollTop = scrollTopForRatio(view.scrollDOM, ratio);
}

const highlightLineEffect = StateEffect.define<number | null>();

const highlightLineField = StateField.define({
  create: () => Decoration.none,
  update(value, transaction) {
    value = value.map(transaction.changes);

    for (const effect of transaction.effects) {
      if (effect.is(highlightLineEffect)) {
        if (effect.value === null) {
          return Decoration.none;
        }

        const line = transaction.state.doc.line(effect.value);
        return Decoration.set([
          Decoration.line({ class: "cm-focused-source-line" }).range(line.from),
        ]);
      }
    }

    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const editableCompartment = new Compartment();

export const SourceEditor = forwardRef<SourceEditorHandle, SourceEditorProps>(function SourceEditor({ content, initialScrollRatio = 0, onChange, focusTarget, onScrollRatio }, ref) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onScrollRatioRef = useRef(onScrollRatio);
  const programmaticScrollRef = useRef(false);

  onChangeRef.current = onChange;
  onScrollRatioRef.current = onScrollRatio;

  useImperativeHandle(ref, () => ({
    getScrollRatio() {
      const view = viewRef.current;
      return view ? scrollRatio(view.scrollDOM) : 0;
    },
    scrollToRatio(ratio: number) {
      const view = viewRef.current;
      if (!view) {
        return;
      }

      programmaticScrollRef.current = true;
      scrollViewToRatio(view, ratio);
      window.setTimeout(() => {
        programmaticScrollRef.current = false;
      }, 80);
    },
  }), []);

  useEffect(() => {
    if (!hostRef.current || viewRef.current) {
      return;
    }

    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: content,
        extensions: [
          lineNumbers(),
          history(),
          markdown(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          highlightLineField,
          editableCompartment.of(EditorView.editable.of(true)),
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
        ],
      }),
    });

    viewRef.current = view;
    const initialScrollFrame = window.requestAnimationFrame(() => {
      programmaticScrollRef.current = true;
      scrollViewToRatio(view, initialScrollRatio);
      window.setTimeout(() => {
        programmaticScrollRef.current = false;
      }, 80);
    });

    const handleScroll = () => {
      if (programmaticScrollRef.current) {
        return;
      }

      onScrollRatioRef.current?.(scrollRatio(view.scrollDOM));
    };

    view.scrollDOM.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.cancelAnimationFrame(initialScrollFrame);
      view.scrollDOM.removeEventListener("scroll", handleScroll);
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === content) {
      return;
    }

    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: content },
    });
  }, [content]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !focusTarget) {
      return;
    }

    const lineNo = Math.max(1, Math.min(focusTarget.line, view.state.doc.lines));
    const line = view.state.doc.line(lineNo);
    const offset = Math.max(0, Math.min(focusTarget.column - 1, line.length));
    const position = line.from + offset;

    view.dispatch({
      selection: { anchor: position },
      effects: [
        EditorView.scrollIntoView(position, { y: "center" }),
        highlightLineEffect.of(lineNo),
      ],
    });
    view.focus();
  }, [focusTarget]);

  return <div ref={hostRef} className="source-editor" />;
});
