"""A tiny calculator, used to demo Master-Anything's verifiable-mastery loop."""


class Calculator:
    def add(self, a, b):
        return a + b

    def sub(self, a, b):
        return a - b

    def add_many(self, nums):
        total = 0
        for n in nums:
            total = self.add(total, n)
        return total


def average(nums):
    calc = Calculator()
    if not nums:
        return 0
    return calc.add_many(nums) / len(nums)
