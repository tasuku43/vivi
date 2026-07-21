import { createContext, useContext, type ReactNode } from "react";

export type DraftReviewCommentDeleteHandler = (
  id: string,
) => void | Promise<void>;

const DraftReviewCommentDeleteContext = createContext<
  DraftReviewCommentDeleteHandler | undefined
>(undefined);

export function DraftReviewCommentActionsProvider({
  children,
  onDeleteDraft,
}: {
  children: ReactNode;
  onDeleteDraft?: DraftReviewCommentDeleteHandler;
}) {
  return (
    <DraftReviewCommentDeleteContext.Provider value={onDeleteDraft}>
      {children}
    </DraftReviewCommentDeleteContext.Provider>
  );
}

export function useDraftReviewCommentDelete() {
  return useContext(DraftReviewCommentDeleteContext);
}
