import { t } from '@telocc/i18n';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button.tsx';

export function DoneStep() {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-xl font-semibold">{t('onboarding.completeTitle')}</h2>
      <p className="text-neutral-600">{t('onboarding.completeBody')}</p>
      <Button type="button" onClick={() => navigate('/', { replace: true })}>
        {t('onboarding.goToDashboard')}
      </Button>
    </div>
  );
}
