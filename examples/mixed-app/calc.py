"""A tiny calculator used by the mixed code+docs demo."""


class Calculator:
    def add(self, a, b):
        return a + b

    def add_many(self, nums):
        total = 0
        for n in nums:
            total = self.add(total, n)
        return total


def average(nums):
    if not nums:
        return 0
    return Calculator().add_many(nums) / len(nums)
