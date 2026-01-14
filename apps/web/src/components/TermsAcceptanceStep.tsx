import { useState, useRef, useEffect, useCallback } from 'react'
import { useMutation, useApolloClient } from '@apollo/client'
import { ACCEPT_TERMS_MUTATION } from '../graphql/terms'
import { ME_QUERY } from '../graphql/me'
import { TERMS_VERSION, TERMS_LAST_UPDATED, TERMS_TEXT } from '../legal/terms'

interface TermsAcceptanceStepProps {
  onComplete: () => void
}

export function TermsAcceptanceStep({ onComplete }: TermsAcceptanceStepProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false)
  const [isChecked, setIsChecked] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const apolloClient = useApolloClient()
  const [acceptTerms, { loading }] = useMutation(ACCEPT_TERMS_MUTATION)

  // Check scroll position
  const checkScrollPosition = useCallback(() => {
    const el = scrollRef.current
    if (!el) return

    const isAtBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 8
    if (isAtBottom && !hasScrolledToBottom) {
      setHasScrolledToBottom(true)
    }
  }, [hasScrolledToBottom])

  // Handle scroll events
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    el.addEventListener('scroll', checkScrollPosition)
    return () => el.removeEventListener('scroll', checkScrollPosition)
  }, [checkScrollPosition])

  // Handle window resize with ResizeObserver
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const resizeObserver = new ResizeObserver(() => {
      checkScrollPosition()
    })
    resizeObserver.observe(el)

    return () => resizeObserver.disconnect()
  }, [checkScrollPosition])

  // Check initial state (content might not need scrolling on large screens)
  useEffect(() => {
    // Small delay to ensure content is rendered
    const timer = setTimeout(() => {
      checkScrollPosition()
    }, 100)
    return () => clearTimeout(timer)
  }, [checkScrollPosition])

  const handleSubmit = async () => {
    setError(null)

    try {
      await acceptTerms({
        variables: {
          input: { termsVersion: TERMS_VERSION },
        },
      })

      // Refetch user data to update hasAcceptedCurrentTerms
      await apolloClient.refetchQueries({ include: [ME_QUERY] })

      onComplete()
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to accept terms. Please try again.'
      )
    }
  }

  const canSubmit = hasScrolledToBottom && isChecked && !loading

  return (
    <div className="bg-surface border border-app rounded-xl shadow p-6 space-y-5">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold text-primary">
          Terms & Conditions
        </h2>
        <p className="text-sm text-muted mt-1">
          Last Updated: {TERMS_LAST_UPDATED}
        </p>
      </div>

      {/* Error Message */}
      {error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3">
          <p className="text-sm text-danger">{error}</p>
        </div>
      )}

      {/* Scrollable Terms Container */}
      <div
        ref={scrollRef}
        className="h-[60vh] overflow-y-auto rounded-lg border border-app p-5 text-left"
        style={{ scrollbarWidth: 'thin', backgroundColor: '#FAF8F4' }}
      >
        <TermsContent />
      </div>

      {/* Helper Text */}
      <p
        className={`text-sm text-center transition-opacity ${
          hasScrolledToBottom ? 'opacity-0 h-0 overflow-hidden' : 'text-muted'
        }`}
      >
        Scroll to the end to enable acceptance.
      </p>

      {/* Checkbox */}
      <label
        className={`flex items-start gap-3 text-left ${
          hasScrolledToBottom ? 'cursor-pointer' : 'cursor-not-allowed'
        }`}
      >
        <input
          type="checkbox"
          checked={isChecked}
          onChange={(e) => setIsChecked(e.target.checked)}
          disabled={!hasScrolledToBottom}
          className="mt-1 w-5 h-5 rounded border-app bg-surface accent-accent disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
        />
        <span
          className={`text-sm leading-relaxed ${
            !hasScrolledToBottom ? 'text-muted' : 'text-primary'
          }`}
        >
          I have read and understood the Loam Logger Terms & Conditions, and I
          agree to be legally bound by them, including the Mandatory Arbitration
          and Class Action Waiver provisions.
        </span>
      </label>

      {/* Submit Button */}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        className={`
          w-full px-6 py-3 rounded-lg text-sm font-medium transition-all
          ${
            canSubmit
              ? 'bg-accent text-white hover:bg-accent-hover'
              : 'bg-gray-300 dark:bg-gray-700 text-gray-500 cursor-not-allowed'
          }
        `}
      >
        {loading ? 'Submitting...' : 'Agree and Continue'}
      </button>
    </div>
  )
}

// Simple markdown-to-JSX renderer for terms content
function TermsContent() {
  const lines = TERMS_TEXT.split('\n')
  const elements: JSX.Element[] = []
  let key = 0
  let inList = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Skip the first "Last Updated" line since we show it in the header
    if (line.startsWith('**Last Updated:**')) {
      continue
    }

    if (line.startsWith('# ')) {
      if (inList) {
        inList = false
      }
      elements.push(
        <h1 key={key++} className="text-2xl font-bold mb-4" style={{ color: '#0C0C0E' }}>
          {line.slice(2)}
        </h1>
      )
    } else if (line.startsWith('## ')) {
      if (inList) {
        inList = false
      }
      elements.push(
        <h2
          key={key++}
          className="text-lg font-semibold mt-6 mb-3"
          style={{ color: '#0C0C0E' }}
        >
          {line.slice(3)}
        </h2>
      )
    } else if (line.startsWith('### ')) {
      if (inList) {
        inList = false
      }
      elements.push(
        <h3 key={key++} className="text-base font-semibold mt-4 mb-2" style={{ color: '#0C0C0E' }}>
          {line.slice(4)}
        </h3>
      )
    } else if (line.startsWith('---')) {
      if (inList) {
        inList = false
      }
      elements.push(<hr key={key++} className="my-4" style={{ borderColor: '#0C0C0E20' }} />)
    } else if (line.startsWith('- ')) {
      inList = true
      elements.push(
        <li key={key++} className="ml-4 mb-1" style={{ color: '#2A2A2E' }}>
          {parseInlineFormatting(line.slice(2))}
        </li>
      )
    } else if (line.trim() === '') {
      if (inList) {
        inList = false
      }
      // Skip empty lines
    } else {
      if (inList) {
        inList = false
      }
      elements.push(
        <p key={key++} className="mb-2" style={{ color: '#2A2A2E' }}>
          {parseInlineFormatting(line)}
        </p>
      )
    }
  }

  return <>{elements}</>
}

// Handle **bold** inline formatting
function parseInlineFormatting(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-semibold" style={{ color: '#0C0C0E' }}>
          {part.slice(2, -2)}
        </strong>
      )
    }
    return part
  })
}
