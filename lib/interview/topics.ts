import type { InterviewSettings, Language, Level, Role } from "@/lib/types";

type TopicsByLanguage = Record<Language, string[]>;
type TopicsByLevel = Record<Level, TopicsByLanguage>;
type TopicsByRole = Record<Role, TopicsByLevel>;

export const TOPICS: TopicsByRole = {
  Frontend: {
    Junior: {
      EN: [
        "Build a responsive card layout for mobile/desktop - what CSS approach?",
        "Explain lifting state vs local state with a concrete example.",
        "Debug a flexbox alignment bug - what steps would you take?",
        "Form validation: what belongs on client vs server?",
        "Handle loading/empty/error states for a list.",
        "How would you structure a simple React component and its props?",
        "Accessibility basics: labels, focus, keyboard navigation.",
        "Fetching data with hooks and avoiding duplicate requests.",
        "Basic performance: when is memoization helpful?",
        "Write tests for a button or form - what must be covered?"
      ],
      RU: [
        "Сверстать адаптивные карточки для мобайл/десктоп - какой подход в CSS?",
        "Объясните lifting state vs local state на примере.",
        "Как бы вы отлаживали проблему выравнивания во flexbox?",
        "Валидация формы: что на клиенте, что на сервере?",
        "Как обрабатываете состояния loading/empty/error для списка?",
        "Как бы структурировали простой React-компонент и его пропсы?",
        "Базовая доступность: label, фокус, клавиатура.",
        "Получение данных хуками и защита от дублей запросов.",
        "Базовая производительность: когда нужна мемоизация?",
        "Тесты для кнопки/формы: что обязательно покрыть?"
      ]
    },
    Mid: {
      EN: [
        "Design system adoption and enforcing consistency.",
        "SSR vs CSR in Next.js for a dashboard - tradeoffs.",
        "Client caching and invalidation strategy (SWR/React Query).",
        "Bundle size reduction: code splitting and lazy routes.",
        "Architecture for complex forms (multi-step, autosave).",
        "Frontend monitoring for errors and performance in production.",
        "State management tradeoffs (local vs global vs server state).",
        "Migration plan for a legacy UI to a new stack.",
        "How would you run an accessibility audit and fix issues?",
        "Rendering large lists: when and how to virtualize."
      ],
      RU: [
        "Как внедрить дизайн-систему и обеспечить консистентность?",
        "SSR vs CSR в Next.js для дашборда - компромиссы.",
        "Кэш на клиенте и стратегия инвалидции (SWR/React Query).",
        "Снижение размера бандла: code splitting и lazy-routes.",
        "Архитектура сложной формы (multi-step, autosave).",
        "Мониторинг ошибок и производительности фронтенда в проде.",
        "Компромиссы управления состоянием (local/global/server).",
        "План миграции легаси UI на новый стек.",
        "Как провести аудит доступности и исправить проблемы?",
        "Рендер больших списков и виртуализация."
      ]
    },
    Senior: {
      EN: [
        "Frontend architecture for a large product (module boundaries).",
        "Define and enforce performance budgets.",
        "Design system strategy and theming across teams.",
        "Migration plan from a monolith to micro-frontends/module federation.",
        "Quality bar and guardrails (linting, CI, perf budgets).",
        "Leading incident response for a frontend outage.",
        "Cross-team API contracts and versioning.",
        "Frontend security: XSS, CSP, auth flows.",
        "Mentoring, hiring, and leveling expectations.",
        "Roadmap vs tech debt: how do you make tradeoffs?"
      ],
      RU: [
        "Архитектура фронтенда для большого продукта (границы модулей).",
        "Как задаете и контролируете performance-budgets?",
        "Стратегия дизайн-системы и темизации для нескольких команд.",
        "План миграции от монолита к микрофронтам/Module Federation.",
        "Как задаете quality bar и guardrails (lint, CI, perf)?",
        "Как бы вели инцидент с фронтендом в проде?",
        "API-контракты между командами и версионирование.",
        "Безопасность на фронте (XSS, CSP, auth flows).",
        "Менторинг и ожидания по грейдам.",
        "Компромиссы: roadmap vs техдолг."
      ]
    }
  },
  PM: {
    Junior: {
      EN: [
        "Clarify requirements with a stakeholder - what questions do you ask?",
        "Define an MVP for a feature with constraints.",
        "Write a user story with acceptance criteria.",
        "Prioritize backlog items with a framework (RICE/MoSCoW).",
        "Define success metrics for a feature.",
        "Handle scope creep during a sprint.",
        "Coordinate with design and engineering for delivery.",
        "Communicate tradeoffs to stakeholders.",
        "Basic launch checklist for a new feature.",
        "Collect feedback after launch - what do you look at?"
      ],
      RU: [
        "Как уточняете требования у стейкхолдера? Какие вопросы задаете?",
        "Определите MVP для фичи при ограничениях.",
        "Напишите user story и критерии приемки.",
        "Как приоритизировать бэклог (RICE/MoSCoW)?",
        "Какие метрики успеха зададите для фичи?",
        "Как работать со scope creep в спринте?",
        "Как синхронизируетесь с дизайном и разработкой?",
        "Как объясняете компромиссы стейкхолдерам?",
        "Базовый чек-лист перед запуском.",
        "Как собирать обратную связь после релиза?"
      ]
    },
    Mid: {
      EN: [
        "Quarterly roadmap tradeoffs and alignment.",
        "Run an experiment to validate demand.",
        "Analyze product metrics and derive insights.",
        "Balance platform vs feature work.",
        "Handle conflicting stakeholder requests.",
        "Discovery to delivery handoff process.",
        "How does an incident impact roadmap decisions?",
        "Pricing or packaging considerations.",
        "Go-to-market coordination with marketing/sales.",
        "Leading a cross-timezone team."
      ],
      RU: [
        "Компромиссы квартального roadmap и выравнивание.",
        "Как поставить эксперимент для проверки спроса?",
        "Как анализируете продуктовые метрики и делаете выводы?",
        "Баланс платформенных и фичевых задач.",
        "Как решаете конфликтующие запросы стейкхолдеров?",
        "Процесс handoff от discovery к delivery.",
        "Влияние инцидента на план/roadmap.",
        "Ценообразование или упаковка - как подходите?",
        "Координация go-to-market с маркетингом и продажами.",
        "Как работаете с распределенной командой по часовым поясам?"
      ]
    },
    Senior: {
      EN: [
        "Define product strategy and a North Star metric.",
        "Portfolio prioritization across multiple teams.",
        "Build vs buy decisions - how do you evaluate?",
        "Set up a metrics system and reporting cadence.",
        "Executive alignment and communication.",
        "High-stakes tradeoffs: revenue vs retention.",
        "Platform vision and long-term tech investments.",
        "Risk management for major launches.",
        "Mentoring PMs and leveling expectations.",
        "Market analysis and competitive positioning."
      ],
      RU: [
        "Как формируете продуктовую стратегию и North Star?",
        "Как приоритизируете портфель между командами?",
        "Как принимаете решение build vs buy?",
        "Как строите систему метрик и отчетности?",
        "Как выравниваетесь с руководством и коммуницируете наверх?",
        "Как принимаете высокорисковые компромиссы (выручка vs ретеншн)?",
        "Долгосрочное видение платформы и инвестиции.",
        "Управление рисками больших запусков.",
        "Менторинг PM и ожидания по грейдам.",
        "Конкурентный анализ и позиционирование."
      ]
    }
  }
};

export function getTopicForStep(settings: InterviewSettings, step: number) {
  const topics = TOPICS[settings.role][settings.level][settings.language];
  return topics[step % topics.length];
}
