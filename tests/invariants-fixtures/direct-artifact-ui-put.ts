// expected-invariant-failure: proposal-backed-artifact-editing-surfaces

import { updateWorldBible } from "../../ui/src/api"

export async function directArtifactUiPutFixture(novelId: string) {
  await updateWorldBible(novelId, { setting: "Direct edit that bypasses proposal review" })
}
