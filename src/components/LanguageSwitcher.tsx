import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Globe, ChevronDown } from 'lucide-react'
import { SUPPORTED_LANGUAGES } from '../i18n'
import './LanguageSwitcher.css'

interface LanguageSwitcherProps {
  compact?: boolean
}

export function LanguageSwitcher({ compact = false }: LanguageSwitcherProps) {
  const { i18n } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const currentLanguage = SUPPORTED_LANGUAGES.find((lang) => lang.code === i18n.language) || SUPPORTED_LANGUAGES[0]

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function handleSelect(code: string) {
    void i18n.changeLanguage(code)
    setIsOpen(false)
  }

  return (
    <div className={`language-switcher-container ${compact ? 'compact' : ''}`} ref={containerRef}>
      <button
        type="button"
        className="language-switcher-btn"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-label="Select Language"
        title="Switch Language"
      >
        <Globe size={16} className="globe-icon" />
        <span className="lang-flag">{currentLanguage.flag}</span>
        {!compact && <span className="lang-name">{currentLanguage.name}</span>}
        <ChevronDown size={13} className={`chevron-icon ${isOpen ? 'open' : ''}`} />
      </button>

      {isOpen && (
        <div className="language-dropdown" role="menu">
          <div className="dropdown-header">Select Language</div>
          {SUPPORTED_LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              type="button"
              className={`language-option ${i18n.language === lang.code ? 'active' : ''}`}
              onClick={() => handleSelect(lang.code)}
              role="menuitem"
            >
              <span className="option-flag">{lang.flag}</span>
              <span className="option-name">{lang.name}</span>
              {i18n.language === lang.code && <span className="active-dot" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
