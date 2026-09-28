// Checks CLAUDE.md §2: an early releaseShares sent with an explicit gas limit is still
// mined (as a failed tx), so the ReleaseNotStarted rejection is visible on MSTScan.
//
// Run: pnpm --filter contracts exec hardhat run scripts/early-release-check.ts --network testnet
import hre from "hardhat";
import fs from "fs";
import path from "path";

const EXPLORER = "https://testnet.mstscan.com";

async function main() {
  const network = hre.network.name;
  const deployments = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "deployments.json"), "utf8"));
  const address: string | undefined = deployments[network]?.ExamSealRegistry?.address;
  if (!address) throw new Error(`ExamSealRegistry not deployed on ${network}. Run deploy first.`);

  const [deployer] = await hre.ethers.getSigners();
  const registry = await hre.ethers.getContractAt("ExamSealRegistry", address, deployer);
  const { ethers } = hre;

  // Use chain time, never the laptop clock.
  const latest = await ethers.provider.getBlock("latest");
  const chainNow = latest!.timestamp;
  const releaseTime = chainNow + 600;
  const revealTime = releaseTime + 600;
  const freshCustodian = ethers.Wallet.createRandom().address;
  const custodians = [deployer.address, freshCustodian];

  console.log(`Registry:   ${address}`);
  console.log(`Deployer:   ${deployer.address}`);
  console.log(`Custodians: ${custodians.join(", ")}`);
  console.log(`Chain now:  ${chainNow} -> releaseTime ${releaseTime} (+10 min)\n`);

  const createTx = await registry.createExam(
    "Early release check",
    ethers.keccak256(ethers.toUtf8Bytes("early-release-check")),
    releaseTime,
    revealTime,
    custodians,
    2
  );
  const createReceipt = await createTx.wait();
  const examId = (await registry.nextExamId()) - 1n;
  console.log(`createExam  examId=${examId}  block ${createReceipt!.blockNumber}`);
  console.log(`  ${EXPLORER}/tx/${createTx.hash}\n`);

  // Explicit gas limit: skips estimation, so the doomed tx is actually sent and mined.
  const releaseTx = await registry.releaseShares(examId, [1], [ethers.hexlify(ethers.randomBytes(93))], {
    gasLimit: 500_000n,
  });
  console.log(`releaseShares sent: ${releaseTx.hash}`);

  // Poll for the receipt (tx.wait() throws on revert; HardhatEthersProvider lacks waitForTransaction).
  let receipt = null;
  for (let i = 0; i < 60 && !receipt; i++) {
    receipt = await ethers.provider.getTransactionReceipt(releaseTx.hash);
    if (!receipt) await new Promise((r) => setTimeout(r, 2000));
  }
  if (!receipt) throw new Error("No receipt after 120 s");
  console.log(`  mined in block ${receipt.blockNumber}, status ${receipt.status === 1 ? "SUCCESS" : "FAILED (reverted)"}`);
  console.log(`  ${EXPLORER}/tx/${releaseTx.hash}\n`);

  // Replay the call at that block to decode the custom error.
  try {
    await ethers.provider.call({
      from: deployer.address,
      to: address,
      data: releaseTx.data,
      blockTag: receipt.blockNumber,
    });
    console.log("Replay did not revert (unexpected).");
  } catch (err: any) {
    const data: string | undefined = err?.data ?? err?.info?.error?.data ?? err?.error?.data;
    const parsed = data ? registry.interface.parseError(data) : null;
    if (parsed) {
      console.log(`Decoded revert: ${parsed.name}(${parsed.args.map((a: unknown) => String(a)).join(", ")})`);
    } else {
      console.log(`Revert could not be decoded: ${err?.shortMessage ?? err?.message}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
