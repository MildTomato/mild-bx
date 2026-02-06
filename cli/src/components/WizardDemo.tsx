/**
 * Demo of the Wizard framework
 * Run with: supa --wizard-demo
 */

import React, { useState, useEffect } from "react";
import { render, Box, Text } from "ink";
import SelectInput from "ink-select-input";
import {
  useWizard,
  WizardFrame,
  ActiveStep,
  LoadingStep,
  Outro,
} from "./Wizard.js";

type DemoStep = "org" | "project" | "loading" | "done";

function WizardDemo() {
  const wizard = useWizard();
  const [step, setStep] = useState<DemoStep>("org");

  // Simulate loading
  useEffect(() => {
    if (step === "loading") {
      const timer = setTimeout(() => {
        wizard.complete("project", "Project", "my-app");
        setStep("done");
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [step]);

  const renderStep = () => {
    switch (step) {
      case "org": {
        const items = [
          { key: "acme", label: "acme-corp", value: "acme-corp" },
          { key: "personal", label: "personal-org", value: "personal-org" },
        ];
        return (
          <ActiveStep title="Select organization">
            <SelectInput
              items={items}
              onSelect={(item) => {
                wizard.complete("org", "Organization", item.value);
                setStep("project");
              }}
            />
          </ActiveStep>
        );
      }

      case "project": {
        const items = [
          { key: "app", label: "my-app (us-east-1)", value: "my-app" },
          { key: "other", label: "other-project (eu-west-1)", value: "other" },
        ];
        return (
          <ActiveStep title="Select project">
            <SelectInput
              items={items}
              onSelect={() => {
                setStep("loading");
              }}
            />
          </ActiveStep>
        );
      }

      case "loading":
        return <LoadingStep message="Setting up project..." />;

      case "done":
        return <Outro>Demo complete!</Outro>;

      default:
        return null;
    }
  };

  return (
    <WizardFrame
      title="supa demo"
      subtitle="Wizard framework demo"
      wizard={wizard}
    >
      {renderStep()}
    </WizardFrame>
  );
}

export function runWizardDemo() {
  render(<WizardDemo />);
}
