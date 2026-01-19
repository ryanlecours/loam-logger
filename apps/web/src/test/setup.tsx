import '@testing-library/jest-dom';
import { vi, beforeEach } from 'vitest';

// Mock react-icons/fa - everything must be inline due to vi.mock hoisting
vi.mock('react-icons/fa', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  // Create SVG element to match react-icons behavior
  const createIcon = (testId: string, char: string) =>
    function MockIcon() {
      return React.createElement(
        'svg',
        { 'data-testid': testId, xmlns: 'http://www.w3.org/2000/svg' },
        React.createElement('text', null, char)
      );
    };
  return {
    // Navigation/UI icons
    FaEllipsisV: createIcon('kebab-icon', '⋮'),
    FaPlus: createIcon('plus-icon', '+'),
    FaTimes: createIcon('times-icon', '×'),
    FaCheck: createIcon('check-icon', '✓'),
    FaEdit: createIcon('edit-icon', '✎'),
    FaTrash: createIcon('trash-icon', '🗑'),
    FaCog: createIcon('cog-icon', '⚙'),
    FaChevronDown: createIcon('chevron-down-icon', '▼'),
    FaChevronUp: createIcon('chevron-up-icon', '▲'),
    FaChevronRight: createIcon('chevron-right-icon', '▶'),
    FaChevronLeft: createIcon('chevron-left-icon', '◀'),
    // Alert/Status icons
    FaExclamationTriangle: createIcon('warning-icon', '⚠'),
    FaExclamationCircle: createIcon('exclamation-circle-icon', '!'),
    FaInfoCircle: createIcon('info-icon', 'ℹ'),
    FaQuestionCircle: createIcon('question-icon', '?'),
    FaCheckCircle: createIcon('check-circle-icon', '✓'),
    FaClock: createIcon('clock-icon', '⏰'),
    // Domain-specific icons
    FaBicycle: createIcon('bicycle-icon', '🚲'),
    FaMountain: createIcon('mountain-icon', '⛰'),
    FaPencilAlt: createIcon('pencil-icon', '✏'),
    FaStrava: createIcon('strava-icon', 'S'),
    FaWrench: createIcon('wrench-icon', '🔧'),
    FaRoute: createIcon('route-icon', '🛤'),
    FaGripHorizontal: createIcon('grip-icon', '⋮⋮'),
    FaSpinner: createIcon('spinner-icon', '↻'),
    FaExternalLinkAlt: createIcon('external-link-icon', '↗'),
    FaBoxOpen: createIcon('box-icon', '📦'),
    FaChartLine: createIcon('chart-icon', '📈'),
    // Arrows
    FaArrowUp: createIcon('arrow-up-icon', '↑'),
    FaArrowDown: createIcon('arrow-down-icon', '↓'),
    FaArrowLeft: createIcon('arrow-left-icon', '←'),
    FaMinus: createIcon('minus-icon', '-'),
    // Stats icons
    FaFire: createIcon('fire-icon', '🔥'),
    FaTrophy: createIcon('trophy-icon', '🏆'),
    FaMapMarkerAlt: createIcon('map-marker-icon', '📍'),
    FaHeartbeat: createIcon('heartbeat-icon', '💓'),
    FaHistory: createIcon('history-icon', '⏱'),
  };
});

// Mock react-icons/fi - everything must be inline due to vi.mock hoisting
vi.mock('react-icons/fi', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  const createIcon = (testId: string, char: string) =>
    function MockIcon() {
      return React.createElement(
        'svg',
        { 'data-testid': testId, xmlns: 'http://www.w3.org/2000/svg' },
        React.createElement('text', null, char)
      );
    };
  return {
    FiMoreVertical: createIcon('more-icon', '⋮'),
    FiX: createIcon('x-icon', '×'),
    FiCheck: createIcon('check-icon', '✓'),
    FiEdit2: createIcon('edit-icon', '✎'),
    FiTrash2: createIcon('trash-icon', '🗑'),
    FiSettings: createIcon('settings-icon', '⚙'),
    FiChevronDown: createIcon('chevron-down-icon', '▼'),
    FiChevronUp: createIcon('chevron-up-icon', '▲'),
    FiChevronRight: createIcon('chevron-right-icon', '▶'),
    FiChevronLeft: createIcon('chevron-left-icon', '◀'),
    FiAlertTriangle: createIcon('alert-icon', '⚠'),
    FiInfo: createIcon('info-icon', 'ℹ'),
    FiHelpCircle: createIcon('help-icon', '?'),
    FiPlus: createIcon('plus-icon', '+'),
    FiMinus: createIcon('minus-icon', '-'),
  };
});

// Mock react-icons/md
vi.mock('react-icons/md', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  const createIcon = (testId: string, char: string) =>
    function MockIcon() {
      return React.createElement(
        'svg',
        { 'data-testid': testId, xmlns: 'http://www.w3.org/2000/svg' },
        React.createElement('text', null, char)
      );
    };
  return {
    MdOutlineElectricBolt: createIcon('electric-bolt-icon', '⚡'),
  };
});

// Mock react-icons/gi
vi.mock('react-icons/gi', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  const createIcon = (testId: string, char: string) =>
    function MockIcon() {
      return React.createElement(
        'svg',
        { 'data-testid': testId, xmlns: 'http://www.w3.org/2000/svg' },
        React.createElement('text', null, char)
      );
    };
  return {
    GiCarWheel: createIcon('car-wheel-icon', '⚙'),
    GiSuspensionBridge: createIcon('suspension-icon', '🌉'),
  };
});

// Mock react-icons/tb
vi.mock('react-icons/tb', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  const createIcon = (testId: string, char: string) =>
    function MockIcon() {
      return React.createElement(
        'svg',
        { 'data-testid': testId, xmlns: 'http://www.w3.org/2000/svg' },
        React.createElement('text', null, char)
      );
    };
  return {
    TbArrowAutofitHeight: createIcon('autofit-height-icon', '↕'),
  };
});

// Mock react-icons/ri
vi.mock('react-icons/ri', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require('react');
  const createIcon = (testId: string, char: string) =>
    function MockIcon() {
      return React.createElement(
        'svg',
        { 'data-testid': testId, xmlns: 'http://www.w3.org/2000/svg' },
        React.createElement('text', null, char)
      );
    };
  return {
    RiUserHeartLine: createIcon('user-heart-icon', '👤'),
    RiToolsLine: createIcon('tools-icon', '🔧'),
    RiCarLine: createIcon('car-icon', '🚗'),
    RiArrowRightLine: createIcon('arrow-right-icon', '→'),
    RiCheckLine: createIcon('check-line-icon', '✓'),
    RiAlertFill: createIcon('alert-fill-icon', '⚠'),
    RiLinksLine: createIcon('links-icon', '🔗'),
    RiQuestionMark: createIcon('question-mark-icon', '?'),
    RiBellFill: createIcon('bell-icon', '🔔'),
    RiRefreshLine: createIcon('refresh-icon', '↻'),
    RiBookOpenFill: createIcon('book-icon', '📖'),
    RiListCheck2: createIcon('list-check-icon', '☑'),
    RiAlarmWarningLine: createIcon('alarm-warning-icon', '⚠'),
    RiAlertLine: createIcon('alert-line-icon', '⚠'),
    RiSparklingLine: createIcon('sparkling-icon', '✨'),
  };
});

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn(),
};

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Export for use in tests
export { localStorageMock };

// Reset mocks between tests
beforeEach(() => {
  localStorageMock.getItem.mockReset();
  localStorageMock.setItem.mockReset();
  localStorageMock.removeItem.mockReset();
  localStorageMock.clear.mockReset();
});
