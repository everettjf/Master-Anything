"""Functions with NO accompanying test — used to prove characterization makes
the verifiable-Apply loop work without a hand-written test."""


def clamp(x, lo, hi):
    if x < lo:
        return lo
    if x > hi:
        return hi
    return x


def running_sum(nums):
    out = []
    total = 0
    for n in nums:
        total += n
        out.append(total)
    return out


class Stats:
    def total(self, nums):
        s = 0
        for n in nums:
            s += n
        return s
