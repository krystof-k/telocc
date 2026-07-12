/**
 * Czech translation — partial by design (decisions.md #1: "English copy routed
 * through an i18n layer so Czech is a translation file away"). Scope is deliberately
 * narrow: ER-EMG-3's emergency-disclosure/verification namespace, plus the handful of
 * strings shown on the same screens as that disclosure (onboarding's verify step,
 * settings' personal-number section, and the emergency-ack label on the account
 * section). Every other key is intentionally absent and falls back to English —
 * `t()` in `./index.ts` walks this tree first and only falls back to `en` per-key, so
 * a partial `cs` never produces a missing string, just an English one.
 *
 * Translation notes (for owner sign-off): this is safety-relevant copy, so it is a
 * faithful, literal translation of the English meaning — no paraphrasing that could
 * soften or omit the "cannot be dialled through Telocc" instruction.
 */
import type { Messages } from './en.ts';
import type { DeepPartial } from './types.ts';

export const cs = {
  common: {
    loading: 'Načítání…',
    back: 'Zpět',
    cancel: 'Zrušit',
    somethingWentWrong: 'Něco se pokazilo. Zkuste to prosím znovu.',
    rateLimited: 'Příliš mnoho pokusů. Počkejte chvíli a zkuste to znovu.',
  },
  onboarding: {
    verifyIntro:
      'Ověřte osobní telefon, na který se přesměrují hovory, když nejste na svém firemním čísle dostupní.',
    verifySendCode: 'Na toto číslo zašleme SMS se 6místným kódem.',
  },
  verification: {
    title: 'Ověřte své osobní číslo',
    emergencyDisclosure:
      'Přes Telocc nelze volat na tísňová čísla (112, 150, 155, 156, 158). V nouzi vždy volejte přímo z telefonu, nikoli přes Telocc.',
    sendPin: 'Odeslat ověřovací kód',
    enterPin: 'Zadejte 6místný kód',
    confirm: 'Potvrdit',
    smsCodeIntro: 'Váš ověřovací kód Telocc je',
    smsExpiryNotice: 'Platnost tohoto kódu je 10 minut. Nikomu jej nesdělujte.',
    phoneLabel: 'Osobní telefonní číslo (formát E.164, např. +420777123456)',
    phoneInvalid: 'Zadejte platné telefonní číslo v mezinárodním formátu, např. +420777123456.',
    pinLabel: '6místný kód',
    pinInvalid: 'Tento kód není správný.',
    attemptsExceeded: 'Příliš mnoho nesprávných pokusů. Vyžádejte si nový kód.',
    expiredOrInvalid: 'Platnost kódu vypršela, nebo je neplatný. Vyžádejte si nový.',
    resendCooldown: 'Nový kód si budete moci vyžádat za okamžik.',
    verifiedSuccess: 'Číslo ověřeno.',
    changeNumberTitle: 'Změnit nebo znovu ověřit osobní číslo',
  },
  settings: {
    personalNumberTitle: 'Osobní číslo',
    personalNumberBody:
      'Ověřte nebo aktualizujte osobní telefon, na který se přesměrují hovory, když nejste na svém firemním čísle dostupní.',
    accountEmergencyAckLabel: 'Upozornění na tísňová čísla potvrzeno',
  },
} satisfies DeepPartial<Messages>;
