import type { HardhatRuntimeEnvironment } from "hardhat/types";

export async function deployAll(hre: HardhatRuntimeEnvironment) {
  const Registry = await hre.ethers.getContractFactory("ExamSealRegistry");
  const registry = await Registry.deploy();
  await registry.waitForDeployment();

  return {
    ExamSealRegistry: {
      address: await registry.getAddress(),
      constructorArguments: [],
    },
  };
}
