Add-Type -AssemblyName System.Speech

$text = @'
Paid GitHub work rarely fails cleanly. A pull request can satisfy most of an agreement and still miss a required deliverable.

Docket prices that disagreement before work begins. This founder-operated Studio Next case locked one GEN against three weighted criteria and bound delivery to a public pull request, exact commit, successful Actions run, and immutable docket dot yamel.

When the requester disputed the missing machine receipt, GenLayer validators independently fetched the public evidence. Two criteria passed. One failed.

The contract converted that verdict vector into the settlement: point seven GEN to the worker and point three back to the requester.

The same deployed contract also finalized a requester-authorized full payout, while a separate case exercised GenLayer's native appeal lifecycle.

We originally planned Docket behind another escrow protocol. Shipping the GitHub-native flow let us prove the primitive directly. External pilot next.
'@

$output = Join-Path $PSScriptRoot 'voiceover.wav'
$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
$speaker.SelectVoice('Microsoft Hazel Desktop')
$speaker.Rate = 3
$speaker.Volume = 100
$speaker.SetOutputToWaveFile($output)
$speaker.Speak($text)
$speaker.Dispose()
Write-Output $output
