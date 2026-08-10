import * as React from "react";
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { sanitizeUserInput } from "../../lib/html";
import { TOKENS, darkModeStyles, baseStyles } from "./shared-styles";
import type { TemplateConfig } from "./types";

export const COMPOSER_TEMPLATE_VERSION = "1.0.0";

const MAX_BODY_LENGTH = 100_000;

export type ComposerEmailProps = {
  recipientFirstName?: string;
  header?: string;
  previewText?: string;
  body?: string;
  unsubscribeUrl?: string;
};

/**
 * Markdown subset supported by the composer, line-oriented and deterministic.
 * Raw HTML is never interpreted: all text renders through React elements, so
 * anything typed into the body is escaped by construction.
 *
 * Blocks:
 *   ## Heading            section heading
 *   ---                   divider
 *   > quoted lines        callout card (blank "> " line splits paragraphs)
 *   - item / * item       bullet list
 *   [button: Label](url)  centered CTA button, alone on its own line
 *   anything else         paragraph (blank line starts a new paragraph)
 *
 * Inline: **bold**, [text](url). Links and buttons only accept http, https,
 * or mailto URLs; anything else renders as literal text.
 *
 * {{firstName}} anywhere in the body becomes the recipient's first name
 * ("there" when unknown).
 */

type ComposerBlock =
  | { kind: "h2"; text: string }
  | { kind: "hr" }
  | { kind: "callout"; paragraphs: string[] }
  | { kind: "bullets"; items: string[] }
  | { kind: "button"; label: string; href: string }
  | { kind: "paragraph"; text: string };

function isSafeHref(href: string): boolean {
  return /^(https?:\/\/|mailto:)/i.test(href);
}

const BUTTON_LINE = /^\[button:\s*(.+?)\]\((\S+)\)$/;

export function parseComposerBody(body: string): ComposerBlock[] {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ComposerBlock[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();

    if (line === "") {
      i++;
      continue;
    }

    if (/^-{3,}$/.test(line)) {
      blocks.push({ kind: "hr" });
      i++;
      continue;
    }

    if (line.startsWith("## ")) {
      blocks.push({ kind: "h2", text: line.slice(3).trim() });
      i++;
      continue;
    }

    if (line.startsWith(">")) {
      const quoted: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quoted.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      // Blank quoted lines split the callout into paragraphs
      const paragraphs: string[] = [];
      let current: string[] = [];
      for (const q of quoted) {
        if (q === "") {
          if (current.length) paragraphs.push(current.join(" "));
          current = [];
        } else {
          current.push(q);
        }
      }
      if (current.length) paragraphs.push(current.join(" "));
      if (paragraphs.length) blocks.push({ kind: "callout", paragraphs });
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ""));
        i++;
      }
      blocks.push({ kind: "bullets", items });
      continue;
    }

    const buttonMatch = line.match(BUTTON_LINE);
    if (buttonMatch && isSafeHref(buttonMatch[2])) {
      blocks.push({ kind: "button", label: buttonMatch[1], href: buttonMatch[2] });
      i++;
      continue;
    }

    // Paragraph: consecutive non-blank lines that aren't another block type
    const para: string[] = [line];
    i++;
    while (i < lines.length) {
      const next = lines[i].trim();
      if (
        next === "" ||
        next.startsWith("## ") ||
        next.startsWith(">") ||
        /^-{3,}$/.test(next) ||
        /^[-*]\s+/.test(next) ||
        BUTTON_LINE.test(next)
      ) {
        break;
      }
      para.push(next);
      i++;
    }
    blocks.push({ kind: "paragraph", text: para.join(" ") });
  }

  return blocks;
}

/** Inline markdown: **bold** and [text](url), everything else literal. */
const INLINE_TOKEN = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*/g;

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let n = 0;

  INLINE_TOKEN.lastIndex = 0;
  while ((match = INLINE_TOKEN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    if (match[1] !== undefined && match[2] !== undefined) {
      // Link token: only linkify safe protocols, otherwise keep the raw text
      if (isSafeHref(match[2])) {
        nodes.push(
          <Link
            key={`${keyPrefix}-l${n}`}
            href={match[2]}
            className="ll-link"
            style={baseStyles.link}
          >
            {match[1]}
          </Link>
        );
      } else {
        nodes.push(match[0]);
      }
    } else if (match[3] !== undefined) {
      nodes.push(
        <span key={`${keyPrefix}-b${n}`} className="ll-emph" style={baseStyles.emph}>
          {match[3]}
        </span>
      );
    }

    lastIndex = match.index + match[0].length;
    n++;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function renderBlock(block: ComposerBlock, index: number): React.ReactNode {
  const key = `blk-${index}`;
  switch (block.kind) {
    case "h2":
      return (
        <Heading key={key} as="h2" className="ll-h2" style={baseStyles.h2}>
          {renderInline(block.text, key)}
        </Heading>
      );
    case "hr":
      return <Hr key={key} className="ll-hr" style={baseStyles.hr} />;
    case "callout":
      return (
        <Section key={key} className="ll-callout" style={baseStyles.callout}>
          {block.paragraphs.map((p, pi) => (
            <Text
              key={`${key}-p${pi}`}
              className="ll-p"
              style={{
                ...baseStyles.p,
                margin: pi === block.paragraphs.length - 1 ? 0 : "0 0 8px 0",
              }}
            >
              {renderInline(p, `${key}-p${pi}`)}
            </Text>
          ))}
        </Section>
      );
    case "bullets":
      return (
        <Section key={key} style={{ margin: "0 0 12px 0" }}>
          {block.items.map((item, bi) => (
            <Text
              key={`${key}-i${bi}`}
              className="ll-bullets"
              style={baseStyles.bullets}
            >
              {"• "}
              {renderInline(item, `${key}-i${bi}`)}
            </Text>
          ))}
        </Section>
      );
    case "button":
      return (
        <Section key={key} style={{ paddingTop: 8, paddingBottom: 12, textAlign: "center" }}>
          <Button href={block.href} className="ll-button" style={baseStyles.button}>
            {block.label}
          </Button>
        </Section>
      );
    case "paragraph":
      return (
        <Text key={key} className="ll-p" style={baseStyles.p}>
          {renderInline(block.text, key)}
        </Text>
      );
  }
}

export default function ComposerEmail({
  recipientFirstName,
  header,
  previewText,
  body,
  unsubscribeUrl,
}: ComposerEmailProps) {
  const safeName = sanitizeUserInput(recipientFirstName);
  const safeHeader = sanitizeUserInput(header, 200);
  const safePreview = sanitizeUserInput(previewText, 200);
  const greeting = safeName ? `Hi ${safeName},` : "Hi there,";

  const safeBody = sanitizeUserInput(body, MAX_BODY_LENGTH).replace(
    /\{\{\s*firstName\s*\}\}/g,
    safeName || "there"
  );
  const blocks = parseComposerBody(safeBody);

  return (
    <Html>
      <Head>
        <meta name="color-scheme" content="light dark" />
        <meta name="supported-color-schemes" content="light dark" />
        <style dangerouslySetInnerHTML={{ __html: darkModeStyles }} />
      </Head>
      <Preview>{safePreview || safeHeader}</Preview>

      <Body className="ll-body" style={baseStyles.body}>
        <Container className="ll-container" style={baseStyles.container}>
          {/* Brand */}
          <Section style={{ padding: "8px 6px 14px 6px" }}>
            <Text className="ll-brand" style={baseStyles.brand}>
              LoamLogger
            </Text>
          </Section>

          {/* Main Card */}
          <Section className="ll-card" style={baseStyles.card}>
            <Heading className="ll-h1" style={baseStyles.h1}>
              {safeHeader}
            </Heading>

            <Text className="ll-p" style={baseStyles.p}>
              {greeting}
            </Text>

            {blocks.map(renderBlock)}

            <Text
              className="ll-signature"
              style={{
                ...baseStyles.p,
                marginTop: 14,
                marginBottom: 0,
                color: TOKENS.text,
                fontWeight: 800,
              }}
            >
              – Ryan
            </Text>
          </Section>

          {/* Footer */}
          <Section style={baseStyles.footer}>
            <Text className="ll-footer" style={{ ...baseStyles.footerText, marginBottom: 0 }}>
              Loam Logger • You&apos;re receiving this because you signed up for Loam Logger.
            </Text>
            {unsubscribeUrl ? (
              <Text className="ll-footer" style={{ ...baseStyles.footerText, marginTop: 6 }}>
                <Link href={unsubscribeUrl} className="ll-footer-link" style={baseStyles.footerLink}>
                  Unsubscribe
                </Link>
              </Text>
            ) : null}
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

/** Template configuration for admin email UI */
export const templateConfig: TemplateConfig = {
  id: "composer",
  displayName: "Composer",
  description:
    "Write any update in Markdown: ## headings, --- dividers, > callouts, - bullets, **bold**, [links](url), and [button: Label](url) CTAs. No code change needed.",
  defaultSubject: "An update from Loam Logger",
  emailType: "custom",
  templateVersion: COMPOSER_TEMPLATE_VERSION,
  adminVisible: true,
  parameters: [
    {
      key: "recipientFirstName",
      label: "First Name",
      type: "text",
      required: false,
      autoFill: "recipientFirstName",
    },
    {
      key: "header",
      label: "Header",
      type: "text",
      required: true,
      helpText: "The large heading inside the email card (can differ from the subject line)",
    },
    {
      key: "previewText",
      label: "Preview Text",
      type: "text",
      required: false,
      helpText: "Short preview shown in email clients; falls back to the header",
    },
    {
      key: "body",
      label: "Body (Markdown)",
      type: "textarea",
      required: true,
      helpText:
        "## heading, --- divider, > callout, - bullet, **bold**, [link](https://...), [button: Label](https://...) on its own line. Blank line starts a new paragraph. {{firstName}} inserts the recipient's first name. Greeting and signature are added automatically.",
    },
    {
      key: "unsubscribeUrl",
      label: "Unsubscribe URL",
      type: "hidden",
      required: false,
      autoFill: "unsubscribeUrl",
    },
  ],
  render: (props) => React.createElement(ComposerEmail, props as ComposerEmailProps),
};
