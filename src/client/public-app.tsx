import React from 'react';
import { ExternalLink, Github } from 'lucide-react';
import { Shell, SecurityContent, REPOSITORY } from './components/Shell';
import { usePreferences } from './preferences';
export function PublicApp() {
  const { t } = usePreferences();
  return <Shell publicSite><main className="public-main" itemScope itemType="https://schema.org/SoftwareApplication">
    <meta itemProp="name" content="Steam Cloud Manager" /><meta itemProp="applicationCategory" content="UtilitiesApplication" />
    <meta itemProp="operatingSystem" content="Web Browser" /><link itemProp="license" href={`${REPOSITORY}/blob/main/LICENSE`} />
    <section className="public-intro"><h1>{t.publicTitle}</h1><p className="lead" itemProp="description">{t.description}</p>
      <p className="local-only-note">{t.localOnly}</p><div className="public-actions"><a className="button button-primary" href="/app/"><ExternalLink size={18} />{t.install}</a><a className="button" href={REPOSITORY} target="_blank" rel="noreferrer"><Github size={18} />{t.source}</a></div>
      <ul className="features"><li>{t.featureBrowse}</li><li>{t.featureBackup}</li><li>{t.featureDelete}</li></ul>
    </section>
    <section id="install" className="public-section"><h2>{t.installSteps}</h2><p>{t.requirements}</p><p>{t.installHelp}</p>
      <a className="button button-primary" href="/app/">{t.launchLocal}</a>
    </section>
    <section className="public-section"><h2>{t.securityTitle}</h2><SecurityContent /></section>
    <section className="public-section"><h2>{t.architecture}</h2><p>{t.architectureText}</p></section>
  </main></Shell>;
}
