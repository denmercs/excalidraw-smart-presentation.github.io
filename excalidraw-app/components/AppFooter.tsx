import { Button, Footer } from "@excalidraw/excalidraw/index";
import React, { useCallback } from "react";
import { useI18n } from "@excalidraw/excalidraw/i18n";
import { useExcalidrawActionManager } from "@excalidraw/excalidraw/components/App";
import {
  actionPresent,
  actionCreateProgressiveReveal,
} from "@excalidraw/excalidraw/actions";

import { isExcalidrawPlusSignedUser } from "../app_constants";

import { DebugFooter, isVisualDebuggerEnabled } from "./DebugCanvas";
import { EncryptedIcon } from "./EncryptedIcon";
import { ExcalidrawPlusAppLink } from "./ExcalidrawPlusAppLink";

export const AppFooter = React.memo(
  ({ onChange }: { onChange: () => void }) => {
    const { t } = useI18n();
    const actionManager = useExcalidrawActionManager();
    const onPresent = useCallback(
      () => actionManager.executeAction(actionPresent),
      [actionManager],
    );
    const onCreateProgressiveReveal = useCallback(
      () => actionManager.executeAction(actionCreateProgressiveReveal),
      [actionManager],
    );
    const isProgressiveRevealEnabled = actionManager.isActionEnabled(
      actionCreateProgressiveReveal,
    );

    return (
      <Footer>
        <div
          style={{
            display: "flex",
            gap: ".5rem",
            alignItems: "center",
          }}
        >
          {isVisualDebuggerEnabled() && <DebugFooter onChange={onChange} />}
          {isExcalidrawPlusSignedUser ? (
            <ExcalidrawPlusAppLink />
          ) : (
            <EncryptedIcon />
          )}
          <Button
            onSelect={onCreateProgressiveReveal}
            style={{ width: "fit-content" }}
            title={
              isProgressiveRevealEnabled
                ? undefined
                : `${t(
                    "labels.createProgressiveReveal",
                  )} — Select a single frame with elements`
            }
          >
            {t("labels.createProgressiveReveal")}
          </Button>
          <Button onSelect={onPresent} style={{ width: "fit-content" }}>
            {t("labels.present")}
          </Button>
        </div>
      </Footer>
    );
  },
);
