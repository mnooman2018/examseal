// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice FROZEN INTERFACE (CLAUDE.md §6). Change only with Sampurna + Nooman agreement.
interface IExamSealRegistry {
    enum CentreStatus { None, Sealed, Released, Compromised }

    struct ExamView {
        address authority;
        string title;
        bytes32 paperCommitment;
        uint64 releaseTime;      // chain time; releases revert before this
        uint64 revealTime;       // fingerprints can be revealed from this time
        uint8 threshold;         // e.g. 3
        uint32 centreCount;
        uint64 createdBlock;
        address[] custodians;    // order = Shamir piece index (custodian i holds piece i)
    }

    struct CentreView {
        CentreStatus status;
        uint8 approvals;
        bytes32 encPubKey;              // centre X25519 public key
        bytes32 variantCommitment;      // keccak256(ciphertext), computed ON-CHAIN
        bytes32 fingerprintCommitment;  // keccak256(abi.encode(examId, centreId, fingerprint, salt))
        uint64 registeredBlock;         // block holding EncryptedVariantPublished
        bool fingerprintRevealed;
        bytes32 lastEvidenceHash;
    }

    event ExamCreated(uint256 indexed examId, address indexed authority, string title,
        bytes32 paperCommitment, uint64 releaseTime, uint64 revealTime, uint8 threshold, address[] custodians);
    event CentreRegistered(uint256 indexed examId, uint32 indexed centreId,
        bytes32 encPubKey, bytes32 variantCommitment, bytes32 fingerprintCommitment);
    event EncryptedVariantPublished(uint256 indexed examId, uint32 indexed centreId, bytes ciphertext);
    event ShareReleased(uint256 indexed examId, uint32 indexed centreId, address indexed custodian,
        bytes sealedShare, uint8 approvals);
    event ShareSkipped(uint256 indexed examId, uint32 indexed centreId, address indexed custodian, uint8 reason);
        // reason: 1 = compromised, 2 = duplicate, 3 = unknown centre, 4 = bad length
    event ReleaseAuthorized(uint256 indexed examId, uint32 indexed centreId, uint64 timestamp);
    event LeakRecorded(uint256 indexed examId, uint32 indexed centreId, bytes32 evidenceHash,
        uint16 matched, uint16 observed);
    event CentreRevoked(uint256 indexed examId, uint32 indexed centreId, bytes32 reasonHash);
    event FingerprintRevealed(uint256 indexed examId, uint32 indexed centreId, bytes fingerprint);

    error NotAuthority();
    error NotCustodian();
    error ExamNotFound();
    error CentreNotFound();
    error ReleaseNotStarted(uint64 releaseTime, uint64 nowTs);
    error RegistrationClosed();
    error RevealNotStarted(uint64 revealTime, uint64 nowTs);
    error BadThreshold();
    error BadTimes();
    error BadCustodians();
    error CentreExists();
    error BadPubKey();
    error LengthMismatch();
    error CommitmentMismatch();
    error AlreadyRevealed();

    function createExam(string calldata title, bytes32 paperCommitment, uint64 releaseTime,
        uint64 revealTime, address[] calldata custodians, uint8 threshold) external returns (uint256 examId);

    function registerCentres(uint256 examId, uint32[] calldata centreIds, bytes32[] calldata encPubKeys,
        bytes32[] calldata fingerprintCommitments, bytes[] calldata variantCiphertexts) external;

    function releaseShares(uint256 examId, uint32[] calldata centreIds, bytes[] calldata sealedShares) external;

    function recordLeak(uint256 examId, uint32 centreId, bytes32 evidenceHash, uint16 matched, uint16 observed) external;

    function revokeCentre(uint256 examId, uint32 centreId, bytes32 reasonHash) external;

    function revealFingerprint(uint256 examId, uint32 centreId, bytes calldata fingerprint, bytes32 salt) external;

    function getExam(uint256 examId) external view returns (ExamView memory);
    function getCentre(uint256 examId, uint32 centreId) external view returns (CentreView memory);
    function getCentreIds(uint256 examId) external view returns (uint32[] memory);
    function getShares(uint256 examId, uint32 centreId)
        external view returns (address[] memory custodians, bytes[] memory sealedShares);
    function hasReleased(uint256 examId, uint32 centreId, address custodian) external view returns (bool);
    function nextExamId() external view returns (uint256);
}
