import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { I18nProvider, useI18n } from '../i18n/I18nProvider';

function Probe() {
    const { lang, setLang, t } = useI18n();
    return (
        <div>
            <span data-testid="lang">{lang}</span>
            <span data-testid="title">{t('nav.overview')}</span>
            <span data-testid="interp">{t('logs.entries', { count: 42 })}</span>
            <button onClick={() => setLang('tr')}>toTR</button>
        </div>
    );
}

describe('i18n', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('defaults to English and renders translations', () => {
        render(
            <I18nProvider>
                <Probe />
            </I18nProvider>,
        );
        expect(screen.getByTestId('lang').textContent).toBe('en');
        expect(screen.getByTestId('title').textContent).toBe('Overview');
        expect(screen.getByTestId('interp').textContent).toBe('42 entries');
    });

    it('switches to Turkish and persists the choice', () => {
        render(
            <I18nProvider>
                <Probe />
            </I18nProvider>,
        );
        fireEvent.click(screen.getByText('toTR'));
        expect(screen.getByTestId('lang').textContent).toBe('tr');
        expect(screen.getByTestId('title').textContent).toBe('Genel Bakış');
        expect(localStorage.getItem('aegis.lang')).toBe('tr');
    });

    it('restores the persisted language on mount', () => {
        localStorage.setItem('aegis.lang', 'tr');
        render(
            <I18nProvider>
                <Probe />
            </I18nProvider>,
        );
        expect(screen.getByTestId('lang').textContent).toBe('tr');
        expect(screen.getByTestId('title').textContent).toBe('Genel Bakış');
    });

    it('falls back to the raw key for unknown keys', () => {
        let tFn;
        function Grabber() {
            tFn = useI18n().t;
            return null;
        }
        render(
            <I18nProvider>
                <Grabber />
            </I18nProvider>,
        );
        expect(tFn('does.not.exist')).toBe('does.not.exist');
    });
});
