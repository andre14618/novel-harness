export const DIRECT_ARTIFACT_PUT_DISABLED_MESSAGE =
  "Direct artifact PUT routes are disabled by default; queue planning_edit proposals via /api/novel/:novelId/planning-proposals"

export function directArtifactPutEnabled(): boolean {
  return false
}

export function directArtifactPutDisabledResponse(): Response {
  return Response.json(
    {
      ok: false,
      error: DIRECT_ARTIFACT_PUT_DISABLED_MESSAGE,
      replacementRoute: "/api/novel/:novelId/planning-proposals",
    },
    { status: 403 },
  )
}
