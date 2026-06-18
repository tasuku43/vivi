class Vivi < Formula
  desc "Read-only visual workspace viewer for agent-written local files"
  homepage "https://github.com/tasuku43/vivi"
  license "MIT"

  version "0.1.0"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/tasuku43/vivi/releases/download/v#{version}/vivi_Darwin_arm64.tar.gz"
      sha256 "REPLACE_WITH_DARWIN_ARM64_SHA256"
    else
      url "https://github.com/tasuku43/vivi/releases/download/v#{version}/vivi_Darwin_x86_64.tar.gz"
      sha256 "REPLACE_WITH_DARWIN_X86_64_SHA256"
    end
  end

  on_linux do
    if Hardware::CPU.arm? && Hardware::CPU.is_64_bit?
      url "https://github.com/tasuku43/vivi/releases/download/v#{version}/vivi_Linux_arm64.tar.gz"
      sha256 "REPLACE_WITH_LINUX_ARM64_SHA256"
    else
      url "https://github.com/tasuku43/vivi/releases/download/v#{version}/vivi_Linux_x86_64.tar.gz"
      sha256 "REPLACE_WITH_LINUX_X86_64_SHA256"
    end
  end

  def install
    bin.install "vivi"
  end

  test do
    assert_match "vivi", shell_output("#{bin}/vivi --help")
    assert_match version.to_s, shell_output("#{bin}/vivi --version")
  end
end
