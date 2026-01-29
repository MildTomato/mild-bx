/**
 * Shared organization selection/creation flow
 * Used by both init and projects new commands
 */

import React, { useState, useEffect } from 'react';
import { Box } from 'ink';
import { Spinner, Status } from './Spinner.js';
import { OrgPicker, NameInput, CreateOrSelectChoice } from './Pickers.js';
import { createClient, type Organization } from '../lib/api.js';
import { getAccessToken } from '../lib/config.js';
import { createOrganization as createOrgOp } from '../lib/operations.js';

type OrgFlowStep = 'loading' | 'choice' | 'select' | 'name' | 'creating';

interface OrgFlowProps {
  onComplete: (org: Organization) => void;
  onError: (error: string) => void;
}

export function OrgFlow({ onComplete, onError }: OrgFlowProps) {
  const [step, setStep] = useState<OrgFlowStep>('loading');
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [orgName, setOrgName] = useState<string>('');

  useEffect(() => {
    loadOrgs();
  }, []);

  async function loadOrgs() {
    const token = getAccessToken();
    if (!token) {
      onError('Not authenticated');
      return;
    }

    try {
      const client = createClient(token);
      const organizations = await client.listOrganizations();
      setOrgs(organizations);
      setStep('choice');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load organizations');
    }
  }

  async function createOrg(name: string) {
    const token = getAccessToken();
    if (!token) {
      onError('Not authenticated');
      return;
    }

    try {
      const newOrg = await createOrgOp({ token, name });
      onComplete(newOrg);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to create organization');
    }
  }

  if (step === 'loading') {
    return <Spinner message="Loading organizations..." />;
  }

  if (step === 'choice') {
    return (
      <CreateOrSelectChoice
        entityName="organization"
        existingCount={orgs.length}
        existingNames={orgs.map(o => o.name)}
        onChoice={(choice) => {
          if (choice === 'new') {
            setStep('name');
          } else {
            setStep('select');
          }
        }}
      />
    );
  }

  if (step === 'select') {
    return (
      <OrgPicker
        onSelect={onComplete}
        onError={onError}
      />
    );
  }

  if (step === 'name') {
    const suggestedName = `my-org-${Date.now().toString(36).slice(-4)}`;
    return (
      <NameInput
        label="Organization name:"
        placeholder={suggestedName}
        defaultValue={suggestedName}
        hint="Organizations group related projects together"
        onSubmit={(name) => {
          setOrgName(name);
          setStep('creating');
          createOrg(name);
        }}
      />
    );
  }

  if (step === 'creating') {
    return <Spinner message={`Creating organization "${orgName}"...`} />;
  }

  return null;
}
